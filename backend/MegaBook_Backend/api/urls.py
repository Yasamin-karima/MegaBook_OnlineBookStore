from django.urls import path
from .views import AccountAPIView

urlpatterns = [
    path('list/', AccountAPIView.as_view())
]