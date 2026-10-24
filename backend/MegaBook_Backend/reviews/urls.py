from django.urls import path

from .views import BookReviewListCreateView, MyReviewView

# Included under catalog/books/<int:book_id>/reviews/ (project urls.py)
urlpatterns = [
    # GET: the book's visible reviews (public) / POST: write my review (buyers only)
    path('', BookReviewListCreateView.as_view(), name='book_reviews'),
    # PATCH / DELETE: my own review of this book
    path('mine/', MyReviewView.as_view(), name='my_review'),
]
