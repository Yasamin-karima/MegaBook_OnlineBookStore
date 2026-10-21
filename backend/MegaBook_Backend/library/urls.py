from django.urls import path

from .views import LibraryListView, LibrarySummaryView, MyUploadsView

# All need login; each user only sees their own library
urlpatterns = [
    path('', LibraryListView.as_view(), name='library'),
    path('summary/', LibrarySummaryView.as_view(), name='library_summary'),
    path('uploads/', MyUploadsView.as_view(), name='my_uploads'),
]
