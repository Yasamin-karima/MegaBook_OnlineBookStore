from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import BookRequestCreateSerializer

MESSAGES = {
    services.REQUESTED: "درخواست شما ثبت شد",
    services.AVAILABLE: "این کتاب همین حالا در فروشگاه مگابوک موجود است.",
    services.REJECTED: "درخواست این کتاب بررسی و رد شده است.",
    services.ALREADY_REQUESTED: "قبلاً این کتاب را درخواست داده‌اید",
}


class BookRequestCreateView(APIView):
    """
    POST /book-requests/  (فقط کاربر واردشده، JSON)
    بدنه: { isbn, title, authors?, cover_url?, notes? }

    201 requested           ثبت شد (چه درخواست تازه، چه پیوستن به درخواست موجود؛ عمداً یکسان)
    409 available           کتاب تاییدشده در فروشگاه هست (+ book_id)
    409 rejected            درخواست این شابک رد شده (+ rejection_reason)
    409 already_requested   همین کاربر قبلاً درخواست داده
    400                     ورودی نامعتبر: { field: ["پیام"] }
    409 یعنی ورودی درست بود ولی وضعیت فعلی داده‌ها اجازه‌ی ساختن نداد.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = BookRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        outcome = services.submit_request(
            request.user,
            isbn=data["isbn"],
            title=data["title"],
            authors=data.get("authors", ""),
            cover_url=data.get("cover_url", ""),
            notes=data.get("notes", ""),
        )

        # پاسخ موفق عمداً کم‌جزئیات است: نه id درخواست، نه عنوان ذخیره‌شده، نه تعداد
        # درخواست‌کننده‌ها؛ هر کدام لو می‌داد که کس دیگری قبلاً این کتاب را خواسته یا نه.
        body = {"result": outcome.result, "message": MESSAGES[outcome.result], "isbn": data["isbn"]}
        if outcome.result == services.AVAILABLE:
            body["book_id"] = outcome.book_id
        elif outcome.result == services.REJECTED:
            body["rejection_reason"] = outcome.rejection_reason

        code = status.HTTP_201_CREATED if outcome.result == services.REQUESTED else status.HTTP_409_CONFLICT
        return Response(body, status=code)
