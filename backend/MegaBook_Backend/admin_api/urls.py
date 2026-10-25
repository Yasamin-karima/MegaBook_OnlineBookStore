"""/admin-api/: the React admin dashboard's API. Staff only; everyone else gets 404."""
from django.urls import path

from . import books, conversations, home, request_queue, reviews, taxonomy, users, wallet


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
    # Home and the side menu
    path("counts/", home.CountsView.as_view(), name="admin_api_counts"),
    path("summary/", home.SummaryView.as_view(), name="admin_api_summary"),
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
    # The conversations inbox
    path("conversations/", conversations.InboxView.as_view(), name="admin_api_conversations"),
    path("conversations/<int:pk>/", conversations.InboxItemView.as_view(), name="admin_api_conversation"),
    # Wallet
    path("wallet/topups/", wallet.RequestListView.as_view(**wallet.TOPUP_LIST), name="admin_api_topups"),
    path("wallet/topups/<int:pk>/approve/", wallet.TopupDecisionView.as_view(action="approve"), name="admin_api_topup_approve"),
    path("wallet/topups/<int:pk>/reject/", wallet.TopupDecisionView.as_view(action="reject"), name="admin_api_topup_reject"),
    path("wallet/withdrawals/", wallet.RequestListView.as_view(**wallet.WITHDRAWAL_LIST), name="admin_api_withdrawals"),
    path(
        "wallet/withdrawals/<int:pk>/complete/", wallet.WithdrawalDecisionView.as_view(action="complete"),
        name="admin_api_withdrawal_complete",
    ),
    path(
        "wallet/withdrawals/<int:pk>/reject/", wallet.WithdrawalDecisionView.as_view(action="reject"),
        name="admin_api_withdrawal_reject",
    ),
    path("wallet/adjustments/", wallet.AdjustmentView.as_view(), name="admin_api_adjustments"),
    # Reviews
    path("reviews/", reviews.ReviewListView.as_view(), name="admin_api_reviews"),
    path("reviews/<int:pk>/check/", reviews.ReviewActionView.as_view(action="check"), name="admin_api_review_check"),
    path("reviews/<int:pk>/hide/", reviews.ReviewActionView.as_view(action="hide"), name="admin_api_review_hide"),
    path("reviews/<int:pk>/unhide/", reviews.ReviewActionView.as_view(action="unhide"), name="admin_api_review_unhide"),
    # Users (read-only)
    path("users/", users.UserListView.as_view(), name="admin_api_users"),
    path("users/<int:pk>/", users.UserDetailView.as_view(), name="admin_api_user"),
]
