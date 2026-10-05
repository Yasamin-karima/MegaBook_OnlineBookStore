from django.urls import path

from .views import BookCreateView, CategoryListView

urlpatterns = [
    path('books/', BookCreateView.as_view(), name='book_create'),
    path('categories/', CategoryListView.as_view(), name='category_list'),
]
