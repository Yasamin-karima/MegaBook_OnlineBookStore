from rest_framework import serializers

from catalog.isbn import ISBN_EMPTY, InvalidISBN, normalize_isbn
from catalog.serializers import messages

from .models import BookRequest

NOTES_MAX = 500  # همان NOTE_MAX صفحه‌ی درخواست


class BookRequestCreateSerializer(serializers.Serializer):
    """فقط اعتبارسنجی ورودی. قانون‌های کسب‌وکار (موجود بودن، رد شده، تکراری) در services.py است.

    requester و status اینجا فیلد نیستند، پس اگر کلاینت آن‌ها را بفرستد نادیده گرفته می‌شوند:
    درخواست‌کننده همیشه request.user است و وضعیت همیشه با open شروع می‌شود.
    """
    isbn = serializers.CharField(error_messages=messages(required=ISBN_EMPTY, blank=ISBN_EMPTY))
    title = serializers.CharField(
        max_length=300,
        error_messages=messages(required="عنوان کتاب را وارد کنید.", blank="عنوان کتاب را وارد کنید."),
    )
    authors = serializers.CharField(max_length=500, required=False, allow_blank=True, error_messages=messages())
    cover_url = serializers.URLField(
        max_length=500, required=False, allow_blank=True,
        error_messages=messages(invalid="آدرس تصویر جلد معتبر نیست."),
    )
    notes = serializers.CharField(
        max_length=NOTES_MAX, required=False, allow_blank=True,
        error_messages=messages(max_length="توضیحات حداکثر ۵۰۰ کاراکتر است."),
    )

    def validate_isbn(self, value):
        # همان منطق شابک کل پروژه: خط تیره، رقم فارسی و ISBN-10 قبول است؛ خروجی ۱۳ رقمی
        try:
            return normalize_isbn(value)
        except InvalidISBN as error:
            raise serializers.ValidationError(str(error))


class PublicRequestSerializer(serializers.ModelSerializer):
    """One open request on the public list.

    The field list is explicit and holds nothing about requesters: no names, emails,
    phones, user ids or notes. requester_count, is_mine and book_in_review are
    annotated by the view's queryset (computed, never stored, DECISIONS 3.6).
    """
    cover = serializers.CharField(source="cover_url", read_only=True)
    requester_count = serializers.IntegerField(read_only=True)
    is_mine = serializers.BooleanField(read_only=True)
    book_in_review = serializers.BooleanField(read_only=True)

    class Meta:
        model = BookRequest
        fields = [
            "id", "isbn", "title", "authors", "cover", "created_at",
            "requester_count", "is_mine", "book_in_review",
        ]
