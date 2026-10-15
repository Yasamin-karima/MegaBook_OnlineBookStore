from django.urls import path

from .views import (
    BookDetailView,
    BookFileLinkView,
    BookListCreateView,
    CategoryListView,
    IsbnLookupView,
    book_file_view,
)

urlpatterns = [
    # GET: فهرست عمومی کتاب‌ها / POST: ساخت کتاب (فقط کاربر واردشده)
    path('books/', BookListCreateView.as_view(), name='book_list_create'),
    path('books/<int:pk>/', BookDetailView.as_view(), name='book_detail'),
    path('categories/', CategoryListView.as_view(), name='category_list'),
    # The full file is private: first a signed link (logged in, allowed users only),
    # then the download itself with that link
    path('books/<int:pk>/file-link/', BookFileLinkView.as_view(), name='book_file_link'),
    path('books/<int:pk>/file/', book_file_view, name='book_file'),
    # GET ?isbn=... : اطلاعات کتاب از Open Library برای پیش‌پر کردن فرم (فقط کاربر واردشده)
    path('isbn-lookup/', IsbnLookupView.as_view(), name='isbn_lookup'),
]
