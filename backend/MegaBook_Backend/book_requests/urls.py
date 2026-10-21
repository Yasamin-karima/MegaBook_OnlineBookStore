from django.urls import path

from .views import BookRequestListCreateView, JoinRequestView

urlpatterns = [
    # GET: لیست عمومی درخواست‌های باز (بدون ورود، بدون هیچ اطلاعاتی از درخواست‌کننده‌ها)
    # POST: ثبت درخواست کتاب بر اساس شابک (فقط کاربر واردشده)
    path('', BookRequestListCreateView.as_view(), name='book_request_create'),
    # POST: «من هم می‌خواهم» روی یک درخواست باز (فقط کاربر واردشده؛ تکرارش بی‌اثر است)
    path('<int:pk>/join/', JoinRequestView.as_view(), name='book_request_join'),
]
