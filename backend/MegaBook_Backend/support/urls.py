from django.urls import path

from .views import (
    ConversationView,
    MarkReadView,
    SendMessageView,
    UnreadView,
    my_request_entry,
    my_upload,
    request_item,
    upload_item,
)


def views_for(prefix, find_parent, describe):
    """The same three endpoints for both kinds of parent; only "find MY parent" and
    "describe it" differ (as_view stores them on each view instance)."""
    name = prefix.rstrip("s")
    kwargs = {"find_parent": find_parent}
    return [
        path(f"{prefix}/<int:pk>/", ConversationView.as_view(**kwargs, describe=describe), name=f"support_{name}"),
        path(f"{prefix}/<int:pk>/messages/", SendMessageView.as_view(**kwargs), name=f"support_{name}_messages"),
        path(f"{prefix}/<int:pk>/read/", MarkReadView.as_view(**kwargs), name=f"support_{name}_read"),
    ]


# All need login; each user only reaches their own request entries and uploads
urlpatterns = [
    *views_for("requests", my_request_entry, request_item),
    *views_for("uploads", my_upload, upload_item),
    path("unread/", UnreadView.as_view(), name="support_unread"),
]
