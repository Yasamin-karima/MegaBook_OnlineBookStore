"""The ONLY place a notification's Persian text, icon and link are built (from its
type and params), when it is served. Changing a sentence here changes it for every
notification, old and new.

Links:
  {"kind": "app", "path": "/books/12"}    a page of the site (the frontend navigates)
  {"kind": "admin", "url": "http://…"}    a Django admin page, for staff notifications
  None                                    the source was deleted: not clickable

Texts never say how many people asked for a book or who uploaded it.
"""
from django.urls import reverse

from .models import Notification

Type = Notification.Type

_FA_DIGITS = str.maketrans("0123456789,", "۰۱۲۳۴۵۶۷۸۹٬")


def _toman(amount):
    return f"{int(amount or 0):,} تومان".translate(_FA_DIGITS)


def _app(path):
    return {"kind": "app", "path": path}


def _admin(request, name, pk):
    url = reverse(f"admin:{name}_change", args=[pk])
    return {"kind": "admin", "url": request.build_absolute_uri(url) if request else url}


def _conversation_path(n):
    """The user's conversation page: /requests/<entry id> or /uploads/<book id>."""
    conversation = n.conversation
    if conversation is None:
        return None
    if conversation.request_entry_id:
        return _app(f"/requests/{conversation.request_entry_id}")
    return _app(f"/uploads/{conversation.book_id}")


def render(n, request=None):
    """{"icon", "text", "link"} for one notification."""
    p = n.params
    title = p.get("title", "")
    reason = p.get("reason", "")
    amount = _toman(p.get("amount"))

    match n.type:
        case Type.REQUEST_FULFILLED:
            # The book page if we know it, otherwise the user's own request page
            link = _app(f"/books/{n.book_id}") if n.book_id else (
                _app(f"/requests/{n.request_entry_id}") if n.request_entry_id else None
            )
            return _out("📚", f"کتاب «{title}» که درخواست داده بودید در فروشگاه قرار گرفت.", link)
        case Type.REQUEST_REJECTED:
            link = _app(f"/requests/{n.request_entry_id}") if n.request_entry_id else None
            return _out("❌", f"درخواست شما برای کتاب «{title}» رد شد. دلیل: {reason}", link)
        case Type.UPLOAD_APPROVED:
            link = _app(f"/books/{n.book_id}") if n.book_id else None
            return _out("✅", f"کتاب «{title}» که بارگذاری کرده بودید تأیید شد و در فروشگاه قرار گرفت.", link)
        case Type.UPLOAD_REJECTED:
            link = _app(f"/uploads/{n.book_id}") if n.book_id else None
            if reason:
                return _out("❌", f"کتاب «{title}» که بارگذاری کرده بودید تأیید نشد. دلیل: {reason}", link)
            # Older notifications, from before Book had a rejection reason
            return _out("❌", f"کتاب «{title}» که بارگذاری کرده بودید تأیید نشد. دلیل را در گفت‌وگوی این بارگذاری ببینید.", link)
        case Type.SUPPORT_REPLY:
            return _out("💬", f"پشتیبانی مگابوک در گفت‌وگوی «{title}» به شما پاسخ داد.", _conversation_path(n))
        case Type.TOPUP_APPROVED:
            link = _app("/wallet") if n.topup_request_id else None
            return _out("💰", f"درخواست شارژ کیف پول به مبلغ {amount} تأیید شد و به موجودی شما اضافه شد.", link)
        case Type.TOPUP_REJECTED:
            link = _app("/wallet") if n.topup_request_id else None
            return _out("❌", f"درخواست شارژ کیف پول به مبلغ {amount} رد شد. دلیل: {reason}", link)
        case Type.WITHDRAWAL_COMPLETED:
            link = _app("/wallet") if n.withdrawal_request_id else None
            return _out("🏦", f"مبلغ {amount} از درخواست برداشت شما به کارتتان واریز شد.", link)
        case Type.WITHDRAWAL_REJECTED:
            link = _app("/wallet") if n.withdrawal_request_id else None
            return _out("❌", f"درخواست برداشت {amount} رد شد و مبلغ به کیف پول شما برگشت. دلیل: {reason}", link)
        case Type.SALE_INCOME:
            link = _app("/wallet") if n.order_item_id else None
            return _out("💰", f"کتاب «{title}» فروخته شد و {amount} سهم شما به کیف پولتان واریز شد.", link)
        case Type.REVIEW_HIDDEN:
            link = _app(f"/books/{n.review.book_id}#reviews") if n.review_id else None
            return _out("🙈", f"نظر شما دربارهٔ کتاب «{title}» توسط مدیر پنهان شد. دلیل: {reason}", link)
        case Type.STAFF_NEW_UPLOAD:
            link = _admin(request, "catalog_book", n.book_id) if n.book_id else None
            return _out("📥", f"کتاب تازه‌ای در انتظار بررسی است: «{title}»", link)
        case Type.STAFF_NEW_REQUEST:
            link = _admin(request, "book_requests_bookrequest", n.book_request_id) if n.book_request_id else None
            return _out("🔎", f"درخواست تازه برای کتاب «{title}» ثبت شد.", link)
        case Type.STAFF_USER_MESSAGE:
            link = _admin(request, "support_conversation", n.conversation_id) if n.conversation_id else None
            return _out("💬", f"کاربر در گفت‌وگوی «{title}» پیام تازه نوشت.", link)
        case Type.STAFF_NEW_TOPUP:
            link = _admin(request, "wallet_topuprequest", n.topup_request_id) if n.topup_request_id else None
            return _out("💳", f"درخواست شارژ کارت‌به‌کارت تازه به مبلغ {amount} در انتظار بررسی است.", link)
        case Type.STAFF_NEW_WITHDRAWAL:
            link = _admin(request, "wallet_withdrawalrequest", n.withdrawal_request_id) if n.withdrawal_request_id else None
            return _out("🏦", f"درخواست برداشت تازه به مبلغ {amount} در انتظار پرداخت است.", link)
    return _out("🔔", n.get_type_display(), None)


def _out(icon, text, link):
    return {"icon": icon, "text": text, "link": link}
