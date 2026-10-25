"""/admin-api/: the React admin dashboard's API. Staff only; everyone else gets 404."""
from django.urls import path

from . import books, conversations, request_queue, taxonomy


def conversation_urls(prefix, find_parent, name):
    """The same five endpoints for both kinds of parent (an upload, a requester's entry)."""
    kwargs = {"find_parent": find_parent}
    base = f"{prefix}/<int:pk>/conversation/"
    return [
        path(base, conversations.ConversationView.as_view(**kwargs), name=f"admin_api_{name}_conversation"),
        path(f"{base}messages/", conversations.SendView.as_view(**kwargs), name=f"admin_api_{name}_messages"),
        path(f"{base}read/", conversations.ReadView.as_view(**kwargs), name=f"admin_api_{name}_read"),
        path(f"{base}close/", conversations.CloseView.as_view(**kwargs), name=f"admin_api_{name}_close"),
        path(f"{base}reopen/", conversations.ReopenView.as_view(**kwargs), name=f"admin_api_{name}_reopen"),
    ]


urlpatterns = [
    # Books
    path("books/", books.BookQueueView.as_view(), name="admin_api_books"),
    path("books/<int:pk>/", books.BookDetailView.as_view(), name="admin_api_book"),
    *conversation_urls("books", conversations.find_book, "book"),
    # Categories and tags
    path("categories/", taxonomy.TaxonomyListView.as_view(**taxonomy.CATEGORY_VIEWS), name="admin_api_categories"),
    path("categories/<int:pk>/", taxonomy.TaxonomyItemView.as_view(**taxonomy.CATEGORY_VIEWS), name="admin_api_category"),
    path("tags/", taxonomy.TaxonomyListView.as_view(**taxonomy.TAG_VIEWS), name="admin_api_tags"),
    path("tags/<int:pk>/", taxonomy.TaxonomyItemView.as_view(**taxonomy.TAG_VIEWS), name="admin_api_tag"),
    # Book requests
    path("book-requests/", request_queue.RequestQueueView.as_view(), name="admin_api_requests"),
    path("book-requests/<int:pk>/", request_queue.RequestDetailView.as_view(), name="admin_api_request"),
    path("book-requests/<int:pk>/mark-reviewed/", request_queue.MarkReviewedView.as_view(), name="admin_api_request_reviewed"),
    *conversation_urls("request-entries", conversations.find_entry, "entry"),
]
