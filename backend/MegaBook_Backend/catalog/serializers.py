from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import Book, Category, Person, Publisher, Tag

MAX_COVER_MB = 5

# پیام‌های پیش‌فرض DRF انگلیسی‌اند؛ این‌ها جای آن‌ها را برای همه‌ی فیلدهای این فایل می‌گیرند.
# کلیدهایی که به یک فیلد مربوط نیستند نادیده گرفته می‌شوند، پس یک دیکشنری برای همه کافی است.
MESSAGES = {
    "required": "این فیلد الزامی است.",
    "blank": "این فیلد نباید خالی باشد.",
    "null": "این فیلد نباید خالی باشد.",
    "invalid": "مقدار واردشده معتبر نیست.",
    "max_length": "حداکثر {max_length} کاراکتر مجاز است.",
    "min_value": "مقدار باید دست‌کم {min_value} باشد.",
    "max_value": "مقدار باید حداکثر {max_value} باشد.",
    "max_string_length": "عدد واردشده خیلی بزرگ است.",
    "not_a_list": "مقدار باید یک فهرست باشد.",
    "empty": "این فیلد نباید خالی باشد.",
    "no_name": "نام فایل مشخص نیست.",
    "invalid_image": "فایل انتخاب‌شده تصویر معتبری نیست.",
}


def messages(**overrides):
    return {**MESSAGES, **overrides}


ISBN_LENGTH = "شابک باید ۱۳ رقم باشد."
ISBN_CHECKSUM = "شابک نامعتبر است. رقم کنترلی آن درست نیست؛ شابک را با روی جلد مقایسه کنید."
ISBN_TAKEN = "کتابی با این شابک قبلاً ثبت شده است."


def isbn13_is_valid(isbn):
    # رقم‌های فرد در ۱ و رقم‌های زوج در ۳ ضرب می‌شوند؛ رقم سیزدهم باید جمع را به مضرب ۱۰ برساند
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(isbn[:12]))
    return (10 - total % 10) % 10 == int(isbn[12])


def is_pdf(file):
    # هم پسوند را چک می‌کنیم و هم چند بایت اول فایل را، چون پسوند را راحت می‌شود عوض کرد
    if not file.name.lower().endswith(".pdf"):
        return False
    head = file.read(5)
    file.seek(0)
    return head == b"%PDF-"


def names_field(max_length, required, required_message=MESSAGES["required"]):
    # فهرستی از نام‌ها؛ در multipart هر نام با همان کلید تکرار می‌شود (authors=...&authors=...)
    return serializers.ListField(
        child=serializers.CharField(max_length=max_length, error_messages=messages()),
        required=required,
        allow_empty=not required,
        write_only=True,
        error_messages=messages(required=required_message, empty=required_message),
    )


class BookCreateSerializer(serializers.ModelSerializer):
    title = serializers.CharField(
        max_length=300, error_messages=messages(required="عنوان کتاب را وارد کنید.", blank="عنوان کتاب را وارد کنید.")
    )
    original_title = serializers.CharField(
        max_length=300, required=False, allow_blank=True, error_messages=messages()
    )
    # بدون UniqueValidator پیش‌فرض (که پیام انگلیسی دارد)؛ یکتایی را خودمان در validate_isbn چک می‌کنیم
    isbn = serializers.CharField(error_messages=messages(required=ISBN_LENGTH, blank=ISBN_LENGTH))

    authors = names_field(200, required=True, required_message="دست‌کم نام یک نویسنده را وارد کنید.")
    translators = names_field(200, required=False)
    tags = names_field(50, required=False)
    # ناشر با نامش می‌آید، نه با id؛ در create پیدا یا ساخته می‌شود
    publisher = serializers.CharField(
        max_length=200, required=False, allow_blank=True, write_only=True, error_messages=messages()
    )
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(),
        required=False,
        allow_null=True,
        error_messages=messages(
            does_not_exist="این دسته‌بندی وجود ندارد.",
            incorrect_type="دسته‌بندی نامعتبر است.",
        ),
    )

    description = serializers.CharField(required=False, allow_blank=True, error_messages=messages())
    # در مدل پیش‌فرض دارد ("fa")، ولی فرم همیشه آن را می‌فرستد، پس اینجا الزامی است
    language = serializers.CharField(
        max_length=10, error_messages=messages(required="زبان کتاب را انتخاب کنید.", blank="زبان کتاب را انتخاب کنید.")
    )
    page_count = serializers.IntegerField(
        min_value=1, max_value=99999, required=False, allow_null=True, error_messages=messages()
    )
    publication_year = serializers.IntegerField(
        min_value=1000,
        max_value=9999,
        required=False,
        allow_null=True,
        error_messages=messages(
            min_value="سال را چهاررقمی وارد کنید.", max_value="سال را چهاررقمی وارد کنید."
        ),
    )
    edition = serializers.CharField(max_length=50, required=False, allow_blank=True, error_messages=messages())

    # در مدل blank=True است، ولی برای ارسال از فرم، جلد الزامی است (بدون تغییر مدل)
    cover = serializers.ImageField(
        error_messages=messages(required="تصویر جلد را انتخاب کنید.", empty="تصویر جلد را انتخاب کنید.")
    )
    book_file = serializers.FileField(
        error_messages=messages(required="فایل PDF کتاب را انتخاب کنید.", empty="فایل PDF کتاب را انتخاب کنید.")
    )
    sample_file = serializers.FileField(required=False, error_messages=messages())

    price = serializers.IntegerField(
        min_value=0,
        max_value=2_147_483_647,  # بیشترین مقدار PositiveIntegerField
        error_messages=messages(
            required="قیمت را وارد کنید. برای کتاب رایگان صفر بنویسید.",
            min_value="قیمت نمی‌تواند منفی باشد.",
        ),
    )

    # فقط برای خواندن: کلاینت نمی‌تواند این‌ها را تعیین کند
    uploaded_by = serializers.ReadOnlyField(source="uploaded_by.username")

    class Meta:
        model = Book
        # به ترتیب فیلدها در فرم (AddBookForm)؛ DRF خطاها را به همین ترتیب برمی‌گرداند
        # و فرم به اولین خطا اسکرول می‌کند
        fields = [
            "id", "cover", "title", "original_title", "authors", "translators",
            "isbn", "edition", "language", "publisher", "page_count", "publication_year",
            "description", "category", "tags", "book_file", "sample_file", "price",
            "status", "uploaded_by", "created_at",
        ]
        read_only_fields = ["status", "created_at"]

    # --- اعتبارسنجی هر فیلد (validate_<نام فیلد> را DRF خودش صدا می‌زند) ---

    def validate_isbn(self, value):
        isbn = value.replace("-", "").replace(" ", "")
        if len(isbn) != 13 or not isbn.isdigit():
            raise serializers.ValidationError(ISBN_LENGTH)
        if not isbn13_is_valid(isbn):
            raise serializers.ValidationError(ISBN_CHECKSUM)
        if Book.objects.filter(isbn=isbn).exists():
            raise serializers.ValidationError(ISBN_TAKEN)
        return isbn

    def _unique_names(self, names):
        # نام تکراری فقط یک بار ذخیره شود؛ ترتیب ورود حفظ می‌شود
        return list(dict.fromkeys(names))

    def validate_authors(self, value):
        return self._unique_names(value)

    def validate_translators(self, value):
        return self._unique_names(value)

    def validate_tags(self, value):
        return self._unique_names(value)

    def validate_cover(self, value):
        # DRF با Pillow مطمئن شده که فایل واقعاً تصویر است؛ اینجا فرمت و حجم را محدود می‌کنیم
        if getattr(value, "image", None) and value.image.format not in ("JPEG", "PNG"):
            raise serializers.ValidationError("تصویر جلد باید JPG یا PNG باشد.")
        if value.size > MAX_COVER_MB * 1024 * 1024:
            raise serializers.ValidationError("حجم تصویر جلد باید کمتر از ۵ مگابایت باشد.")
        return value

    def validate_book_file(self, value):
        if not is_pdf(value):
            raise serializers.ValidationError("فقط فایل PDF پذیرفته می‌شود.")
        return value

    def validate_sample_file(self, value):
        if not is_pdf(value):
            raise serializers.ValidationError("فقط فایل PDF پذیرفته می‌شود.")
        return value

    # --- ساخت ---

    def create(self, validated_data):
        # فیلدهایی که ستون مستقیم Book نیستند را جدا می‌کنیم
        author_names = validated_data.pop("authors")
        translator_names = validated_data.pop("translators", [])
        tag_names = validated_data.pop("tags", [])
        publisher_name = validated_data.pop("publisher", "")

        try:
            # همه یا هیچ: اگر هر مرحله خطا بدهد، هیچ ردیفی در دیتابیس نمی‌ماند
            with transaction.atomic():
                if publisher_name:
                    validated_data["publisher"], _ = Publisher.objects.get_or_create(name=publisher_name)

                # uploaded_by از view می‌آید (serializer.save(uploaded_by=request.user))
                # و status پیش‌فرض مدل، یعنی pending، را می‌گیرد
                book = Book.objects.create(**validated_data)

                # روابط چندبه‌چند فقط بعد از ذخیره‌ی کتاب ممکن است، چون کتاب باید id داشته باشد
                book.authors.set([Person.objects.get_or_create(name=n)[0] for n in author_names])
                book.translators.set([Person.objects.get_or_create(name=n)[0] for n in translator_names])
                book.tags.set([Tag.objects.get_or_create(name=n)[0] for n in tag_names])
        except IntegrityError:
            # اگر دو نفر هم‌زمان همین شابک را بفرستند، چک validate_isbn هر دو را رد نمی‌کند؛
            # قید unique دیتابیس دومی را می‌گیرد و اینجا به پیام قابل‌فهم تبدیلش می‌کنیم
            raise serializers.ValidationError({"isbn": [ISBN_TAKEN]})
        return book

    def to_representation(self, instance):
        # در پاسخ، نام‌ها را برمی‌گردانیم نه idها، همان شکلی که کلاینت فرستاده بود
        data = super().to_representation(instance)
        data["authors"] = [p.name for p in instance.authors.all()]
        data["translators"] = [p.name for p in instance.translators.all()]
        data["tags"] = [t.name for t in instance.tags.all()]
        data["publisher"] = instance.publisher.name if instance.publisher else None
        return data


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name"]
