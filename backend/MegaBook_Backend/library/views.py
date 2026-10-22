from rest_framework import generics, permissions
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Book

from .models import LibraryItem
from .serializers import LibraryBookSerializer, UploadedBookSerializer


class LibraryPagination(PageNumberPagination):
    # The library page shows a 2-column grid and loads more on demand
    page_size = 6


def my_readable_uploads(user):
    """The library shows only uploads that are approved and on sale (books to READ).
    All uploads, in every status, are tracked on "My Requests & Uploads" (dashboard app)."""
    return Book.objects.filter(uploaded_by=user, status=Book.Status.APPROVED)


class LibraryListView(generics.ListAPIView):
    """GET /library/ -> the books I bought, newest purchase first.

    Not filtered by the book's status: a bought book stays in the library (and
    readable) even if it's later taken off the store.
    """
    serializer_class = LibraryBookSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = LibraryPagination

    def get_queryset(self):
        return (
            LibraryItem.objects.filter(user=self.request.user)
            .select_related("book")
            .prefetch_related("book__authors")
        )


class MyUploadsView(generics.ListAPIView):
    """GET /library/uploads/ -> my approved uploads (books I can read), newest first."""
    serializer_class = UploadedBookSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = LibraryPagination

    def get_queryset(self):
        return my_readable_uploads(self.request.user).prefetch_related("authors").order_by("-created_at", "-id")


class LibrarySummaryView(APIView):
    """GET /library/summary/ -> { purchased, uploaded, bookmarked } for the tab counters.

    bookmarked is null: bookmarks have no backend yet (the tab shows no number).
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({
            "purchased": LibraryItem.objects.filter(user=request.user).count(),
            "uploaded": my_readable_uploads(request.user).count(),
            "bookmarked": None,
        })
