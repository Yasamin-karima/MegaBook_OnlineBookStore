"""Demo data for clicking through the admin dashboard: pending uploads with
conversations, book requests with requesters, top-up and withdrawal requests, sales
and reviews.

    docker compose exec backend python manage.py seed_books        # first
    docker compose exec backend python manage.py seed_admin_demo

Everything goes through the normal code paths (model save(), support / wallet / cart /
orders services), so messages, notifications and ledger entries are real. Running it
again does nothing: the demo users are the marker (@megabook.invalid, never a real
address, like the sample uploader of seed_books). Their passwords are unusable: nobody
logs in as them.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from book_requests.models import BookRequest, RequestEntry
from cart import services as cart_services
from catalog.models import Book, Person
from orders import services as order_services
from reviews.models import Review
from support import services as support
from wallet import services as wallet_services
from wallet.models import TopUpRequest

DEMO_USERS = [
    ("demo-sara", "سارا", "موسوی", "09121110001"),
    ("demo-nima", "نیما", "صادقی", "09121110002"),
    ("demo-maryam", "مریم", "احمدی", None),
    ("demo-reza", "رضا", "محمدی", "09121110004"),
]


class Command(BaseCommand):
    help = "Demo data for the admin dashboard (after seed_books). Safe to run twice."

    def handle(self, *args, **options):
        User = get_user_model()
        admin = User.objects.filter(is_superuser=True).order_by("id").first()
        if admin is None:
            raise CommandError("No superuser found. Create one first: python manage.py createsuperuser")
        if User.objects.filter(email="demo-sara@megabook.invalid").exists():
            self.stdout.write("Demo data already exists; nothing to do.")
            return
        on_sale = list(Book.objects.filter(status=Book.Status.APPROVED, price__gt=0).order_by("id")[:3])
        if len(on_sale) < 2:
            raise CommandError("Run seed_books first: the demo buys and reviews its books.")

        with transaction.atomic():
            sara, nima, maryam, reza = [
                User.objects.create_user(
                    email=f"{key}@megabook.invalid", phone=phone, first_name=first, last_name=last, password=None
                )
                for key, first, last, phone in DEMO_USERS
            ]
            author = Person.objects.get_or_create(name="نویسندهٔ نمونه")[0]

            # Two uploads waiting for review, each with a question from its uploader
            for n, (user, title, share, question) in enumerate([
                (sara, "مبانی شبکه‌های پیچیده (نمونه)", 80_000, "سلام. اگر سهم ۸۰ هزار تومان زیاد است، می‌توانم کمترش کنم."),
                (maryam, "جزوهٔ جبر خطی (نمونه)", 0, "سهمی نمی‌خواهم؛ فقط می‌خواهم کتاب در دسترس باشد."),
            ]):
                book = Book.objects.create(
                    title=title, isbn=f"97960000000{n:02d}", seller_share=share, uploaded_by=user,
                    book_file="books/files/demo.pdf", description="کتاب نمونه برای آزمایش داشبورد ادمین.",
                )
                book.authors.add(author)
                support.post_user_message(user, book, question)

            # Requests: one wanted by three people (with a question), one by one person
            popular = BookRequest.objects.create(isbn="9780140449235", title="Beyond Good and Evil", authors="Friedrich Nietzsche")
            for user in (sara, nima, reza):
                RequestEntry.objects.create(request=popular, requester=user)
            support.post_user_message(nima, popular.entries.get(requester=nima), "ترجمهٔ فارسی این کتاب را هم دارید؟")
            single = BookRequest.objects.create(isbn="9789643052232", title="سووشون", authors="سیمین دانشور")
            RequestEntry.objects.create(request=single, requester=maryam)

            # Money: a sale (so the summary and the ledgers have something), a pending
            # card-to-card top-up, and a pending withdrawal
            for user in (nima, reza):
                wallet_services.adjust(wallet_services.wallet_of(user), 500_000, "شارژ نمونه برای آزمایش", admin)
            for book in on_sale[:2]:
                cart_services.add(nima, book.pk)
            order_services.checkout(nima)
            cart_services.add(reza, on_sale[0].pk)
            order_services.checkout(reza)
            TopUpRequest.objects.create(
                user=maryam, amount=200_000, tracking_number="DEMO784512",
                deposited_at=timezone.now() - timedelta(hours=3),
            )
            wallet_services.create_withdrawal(reza, 150_000, "6037991123456786")

            # Reviews with text (the admin list shows only those)
            Review.objects.create(user=nima, book=on_sale[0], rating=5, body="ترجمه روان است و فایل هم کیفیت خوبی دارد.")
            Review.objects.create(user=reza, book=on_sale[0], rating=1, body="برای خرید ارزان به کانال من در تلگرام بیایید.")
            Review.objects.create(user=nima, book=on_sale[1], rating=4)  # rating only: not listed

        self.stdout.write(self.style.SUCCESS("Admin demo data created."))
