from django.urls import path

from .views import DashboardView, MyRequestsView, MyUploadsTrackingView

urlpatterns = [
    path('', DashboardView.as_view(), name='dashboard'),
    # "My Requests & Uploads" (a dashboard sub-page): read-only tracking lists
    path('requests/', MyRequestsView.as_view(), name='my_requests'),
    path('uploads/', MyUploadsTrackingView.as_view(), name='my_uploads_tracking'),
]
