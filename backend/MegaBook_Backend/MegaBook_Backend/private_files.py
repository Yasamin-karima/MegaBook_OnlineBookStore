"""Private uploaded files: books' full files and top-up receipts.

Three layers, so a file stays private even if one layer is misconfigured:
1. Storage outside MEDIA_ROOT, with no URL at all: no /media/ path reaches it.
2. Random file names (a UUID), so a path can't be guessed (an ISBN could be).
3. Served only by a view that checks permission on every download.

Logging in is JWT in the Authorization header, which a plain <a href> can't send.
So the page first asks an authenticated endpoint for a short-lived signed link
(make_link); the signature names one file and one user and expires after
PRIVATE_FILE_LINK_SECONDS. The download view checks it, then checks permission
again, since the user may have lost access in between.
"""
import mimetypes
import os
import uuid
from urllib.parse import quote

from django import forms
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.files.storage import FileSystemStorage
from django.http import FileResponse, Http404, HttpResponse
from django.urls import reverse
from django.utils.deconstruct import deconstructible
from django.utils.functional import cached_property


class PrivateStorage(FileSystemStorage):
    """Files under PRIVATE_MEDIA_ROOT. No base URL: asking for a file's URL is an error."""

    # Read the setting on each use (not once at import), so tests can point it at a temp folder
    @property
    def base_location(self):
        return settings.PRIVATE_MEDIA_ROOT

    @property
    def location(self):
        return os.path.abspath(self.base_location)

    @cached_property
    def base_url(self):
        return None

    def url(self, name):
        raise ValueError("Private files have no public URL; use a signed link (private_files.make_link).")


_private_storage = PrivateStorage()


def private_storage():
    # A callable, so migrations record "private_storage", not the storage's settings
    return _private_storage


@deconstructible
class RandomName:
    """upload_to that stores a file as <folder>/<uuid>.<ext>, keeping only the extension."""

    def __init__(self, folder):
        self.folder = folder

    def __call__(self, instance, filename):
        ext = os.path.splitext(filename)[1].lower()
        return f"{self.folder}/{uuid.uuid4().hex}{ext}"

    def __eq__(self, other):
        return isinstance(other, RandomName) and other.folder == self.folder


# --- Signed links ---

def _signer(kind):
    # A salt per kind: a token for a receipt can never open a book file, and vice versa
    return signing.TimestampSigner(salt=f"megabook.private-file.{kind}")


def make_link(request, kind, url_name, obj_pk, user):
    """An absolute download URL for one object's file, for one user, valid for a few minutes."""
    token = _signer(kind).sign_object({"o": obj_pk, "u": user.pk})
    url = request.build_absolute_uri(reverse(url_name, args=[obj_pk]))
    return {"url": f"{url}?t={token}", "expires_in": settings.PRIVATE_FILE_LINK_SECONDS}


def user_from_token(kind, token, obj_pk):
    """The active user the token was made for, or None if it's missing, forged,
    expired, or made for another object."""
    if not token:
        return None
    try:
        data = _signer(kind).unsign_object(token, max_age=settings.PRIVATE_FILE_LINK_SECONDS)
    except signing.BadSignature:  # also covers SignatureExpired
        return None
    if data.get("o") != obj_pk:
        return None
    return get_user_model().objects.filter(pk=data.get("u"), is_active=True).first()


def download_user(request, kind, obj_pk):
    """Who is downloading: the user in a valid signed link, or a staff member logged in
    to the admin (session cookie), so admin pages can link to files directly."""
    if request.user.is_authenticated and request.user.is_staff:
        return request.user
    return user_from_token(kind, request.GET.get("t"), obj_pk)


# --- Sending the file ---

def file_response(field_file, download_name):
    """Send a private file. 404 if it's missing on disk.

    With PRIVATE_MEDIA_ACCEL_PREFIX set (production behind nginx), Django sends only
    a header and nginx sends the file itself, which is much faster for big PDFs.
    """
    if not field_file or not field_file.storage.exists(field_file.name):
        raise Http404
    content_type = mimetypes.guess_type(field_file.name)[0] or "application/octet-stream"
    if settings.PRIVATE_MEDIA_ACCEL_PREFIX:
        response = HttpResponse(content_type=content_type)
        response["X-Accel-Redirect"] = settings.PRIVATE_MEDIA_ACCEL_PREFIX.rstrip("/") + "/" + field_file.name
    else:
        response = FileResponse(field_file.open("rb"), content_type=content_type)
    # inline: PDFs and images open in the browser's own viewer; the name is used on save
    ext = os.path.splitext(field_file.name)[1]
    response["Content-Disposition"] = _content_disposition(download_name + ext)
    # Never stored by the browser cache or a proxy
    response["Cache-Control"] = "private, no-store"
    return response


def _content_disposition(filename):
    # filename* (RFC 6266) carries non-ASCII names such as Persian book titles;
    # the plain filename is an ASCII fallback for old clients
    return f"inline; filename=\"download{os.path.splitext(filename)[1]}\"; filename*=UTF-8''{quote(filename)}"


# --- Admin widget ---

class _FileLink:
    """What PrivateFileInput's template shows: the file's name, linking to a view."""

    def __init__(self, name, url):
        self.name, self.url = name, url

    def __str__(self):
        return self.name


class PrivateFileInput(forms.ClearableFileInput):
    """The admin's file input for a private file.

    Django's own widget links to the current file through file.url, which private
    files don't have (it raises). This one links to the permission-checked download
    view instead; the admin's session lets staff through.
    """

    def __init__(self, download_url=None, attrs=None):
        super().__init__(attrs)
        self.download_url = download_url

    def is_initial(self, value):
        return bool(value and getattr(value, "name", None))

    def format_value(self, value):
        if self.is_initial(value):
            return _FileLink(value.name, self.download_url or "#")
        return None
