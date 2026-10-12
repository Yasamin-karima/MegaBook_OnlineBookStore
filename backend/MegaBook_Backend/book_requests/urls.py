from django.urls import path

from .views import BookRequestCreateView

urlpatterns = [
    # POST: ثبت درخواست کتاب بر اساس شابک (فقط کاربر واردشده)
    path('', BookRequestCreateView.as_view(), name='book_request_create'),
]
