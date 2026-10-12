from django.urls import path

from .views import BookDetailView, BookListCreateView, CategoryListView, IsbnLookupView

urlpatterns = [
    # GET: فهرست عمومی کتاب‌ها / POST: ساخت کتاب (فقط کاربر واردشده)
    path('books/', BookListCreateView.as_view(), name='book_list_create'),
    path('books/<int:pk>/', BookDetailView.as_view(), name='book_detail'),
    path('categories/', CategoryListView.as_view(), name='category_list'),
    # GET ?isbn=... : اطلاعات کتاب از Open Library برای پیش‌پر کردن فرم (فقط کاربر واردشده)
    path('isbn-lookup/', IsbnLookupView.as_view(), name='isbn_lookup'),
]
