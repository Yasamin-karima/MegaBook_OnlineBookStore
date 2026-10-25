"""Book reviews: a rating (1-5) and an optional text, one per buyer per book (DECISIONS 13).

A review is published the moment its author submits it. An admin may hide it (with a
reason) and unhide it; hidden reviews are shown only to their author and don't count
in the book's rating. Admins mark reviews "checked"; every submission by the author
makes the review "new" again.

Every state change goes through the methods below (author_submit, hide, unhide,
mark_checked), from the API and from the admin alike, so who/when/reason are always
recorded. The rules that must always hold are in apply_rules() (called from clean()
and save()) and, as the last line of defense, in database constraints.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone

from catalog.models import Book

MIN_RATING = 1
MAX_RATING = 5
MAX_BODY_LENGTH = 2000

RATING_RANGE = "امتیاز باید عددی بین ۱ تا ۵ باشد."
BODY_TOO_LONG = "متن نظر حداکثر می‌تواند ۲٬۰۰۰ نویسه باشد."
HIDE_REASON_REQUIRED = "برای پنهان کردن نظر، دلیل آن را بنویسید."
ALREADY_HIDDEN = "این نظر از قبل پنهان است."
NOT_HIDDEN = "این نظر پنهان نیست."


class ReviewQuerySet(models.QuerySet):
    def visible(self):
        """Reviews everyone may see and that count in the book's rating."""
        return self.filter(hidden_at__isnull=True)


class Review(models.Model):
    # CASCADE: a review belongs to its author and its book. Purchases are kept by
    # PROTECT elsewhere (orders), so in practice neither is deleted while it has one.
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reviews")
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="reviews")
    rating = models.PositiveSmallIntegerField()
    # Optional; stored trimmed, "" when there is no text. Plain text, never rendered as HTML.
    body = models.TextField(blank=True)

    # created_at never changes; submitted_at is the author's last submission (create or
    # edit). Both are set to the same moment on create, so "edited" = submitted_at > created_at.
    # Not auto_now/auto_now_add: an admin action must not move submitted_at.
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    submitted_at = models.DateTimeField(editable=False, db_index=True)

    # "Checked" by an admin; both empty = "new". Reset by every submission of the author.
    checked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    checked_at = models.DateTimeField(null=True, blank=True)

    # The CURRENT hide, all three or none. The history of every hide is in ReviewHide.
    # The reason is shown to the author only; the admin's identity to admins only.
    hidden_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    hidden_at = models.DateTimeField(null=True, blank=True)
    hide_reason = models.TextField(blank=True)

    objects = ReviewQuerySet.as_manager()

    class Meta:
        ordering = ["-submitted_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "book"], name="review_one_per_user_per_book"),
            models.CheckConstraint(
                condition=Q(rating__gte=MIN_RATING) & Q(rating__lte=MAX_RATING),
                name="review_rating_1_to_5",
                violation_error_message=RATING_RANGE,
            ),
            # Hidden means: who, when and a non-blank reason ([^[:space:]], like the
            # account names); visible means none of them
            models.CheckConstraint(
                condition=(Q(hidden_at__isnull=True) & Q(hidden_by__isnull=True) & Q(hide_reason=""))
                | (Q(hidden_at__isnull=False) & Q(hidden_by__isnull=False) & Q(hide_reason__regex=r"[^[:space:]]")),
                name="review_hidden_fields_match",
                violation_error_message=HIDE_REASON_REQUIRED,
            ),
            models.CheckConstraint(
                condition=(Q(checked_at__isnull=True) & Q(checked_by__isnull=True))
                | (Q(checked_at__isnull=False) & Q(checked_by__isnull=False)),
                name="review_checked_fields_match",
            ),
            models.CheckConstraint(
                condition=Q(submitted_at__gte=models.F("created_at")), name="review_submitted_after_created"
            ),
        ]

    def __str__(self):
        return f"{self.rating}★ «{self.book}» ({self.user})"

    @property
    def is_hidden(self):
        return self.hidden_at is not None

    @property
    def is_checked(self):
        return self.checked_at is not None

    @property
    def is_edited(self):
        return self.submitted_at is not None and self.submitted_at > self.created_at

    # --- Rules that always hold ---

    def apply_rules(self):
        """Called from both clean() and save(), like Book.apply_money_rules: Django calls
        clean() only from forms (including the admin), never on a plain save()."""
        errors = {}
        self.body = str(self.body or "").strip()
        self.hide_reason = str(self.hide_reason or "").strip()
        if not isinstance(self.rating, int) or not MIN_RATING <= self.rating <= MAX_RATING:
            errors["rating"] = RATING_RANGE
        if len(self.body) > MAX_BODY_LENGTH:
            errors["body"] = BODY_TOO_LONG
        if (self.hidden_at is not None or self.hidden_by_id is not None) and not self.hide_reason:
            errors["hide_reason"] = HIDE_REASON_REQUIRED
        if errors:
            raise ValidationError(errors)

    def clean(self):
        super().clean()
        self.apply_rules()

    def save(self, *args, **kwargs):
        self.apply_rules()
        if self.submitted_at is None:
            # The first submission: the same moment as created_at, so it isn't "edited"
            self.submitted_at = self.created_at
        super().save(*args, **kwargs)

    # --- State changes (the only way the API and the admin change a review) ---

    def _lock(self):
        """Re-read this row under SELECT ... FOR UPDATE (inside a transaction), so an
        author's edit and an admin's hide at the same moment run one after the other."""
        self.refresh_from_db(from_queryset=type(self).objects.select_for_update())

    def author_submit(self, rating, body):
        """The author submits an edit: published (even if it was hidden), and "new"
        again, at the top of the admin list."""
        with transaction.atomic():
            self._lock()
            now = timezone.now()
            self.rating = rating
            self.body = body
            self.submitted_at = now
            self.checked_by = None
            self.checked_at = None
            if self.is_hidden:
                # Republished by the edit; the hide stays in the history
                self.hides.filter(ended_at__isnull=True).update(ended_at=now, end_kind=ReviewHide.EndKind.AUTHOR_EDIT)
                self.hidden_by = None
                self.hidden_at = None
                self.hide_reason = ""
            self.save()

    def hide(self, admin, reason):
        """Hide the review from everyone but its author. The reason is required."""
        reason = str(reason or "").strip()
        if not reason:
            raise ValidationError({"hide_reason": HIDE_REASON_REQUIRED})
        with transaction.atomic():
            self._lock()
            if self.is_hidden:
                raise ValidationError(ALREADY_HIDDEN)
            now = timezone.now()
            self.hidden_by = admin
            self.hidden_at = now
            self.hide_reason = reason
            # Deciding to hide it is checking it
            self.checked_by = admin
            self.checked_at = now
            self.save()
            ReviewHide.objects.create(review=self, hidden_by=admin, hidden_at=now, reason=reason)
            # The author is told, with the reason (not who hid it)
            from notifications import services as notifications

            notifications.notify(
                notifications.Type.REVIEW_HIDDEN, [self.user], review=self,
                params={"title": self.book.title, "reason": reason},
            )

    def unhide(self, admin):
        """Show the review again; the reason is cleared and the review is checked."""
        with transaction.atomic():
            self._lock()
            if not self.is_hidden:
                raise ValidationError(NOT_HIDDEN)
            now = timezone.now()
            self.hides.filter(ended_at__isnull=True).update(
                ended_at=now, end_kind=ReviewHide.EndKind.ADMIN_UNHIDE, ended_by=admin
            )
            self.hidden_by = None
            self.hidden_at = None
            self.hide_reason = ""
            self.checked_by = admin
            self.checked_at = now
            self.save()

    def mark_checked(self, admin):
        with transaction.atomic():
            self._lock()
            self.checked_by = admin
            self.checked_at = timezone.now()
            self.save()


class ReviewHide(models.Model):
    """One time a review was hidden: kept after the review is shown again (by the
    author's edit or by an admin), so no decision is lost. Admins only."""

    class EndKind(models.TextChoices):
        AUTHOR_EDIT = "author_edit", "ویرایش نویسنده"
        ADMIN_UNHIDE = "admin_unhide", "نمایش دوباره توسط مدیر"

    review = models.ForeignKey(Review, on_delete=models.CASCADE, related_name="hides")
    hidden_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    hidden_at = models.DateTimeField()
    reason = models.TextField()
    # Empty while this hide is the current one
    ended_at = models.DateTimeField(null=True, blank=True)
    end_kind = models.CharField(max_length=20, choices=EndKind.choices, null=True, blank=True)
    # The admin who unhid it (empty when the author's edit ended it)
    ended_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["-hidden_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=Q(reason__regex=r"[^[:space:]]"), name="review_hide_has_reason"),
            models.CheckConstraint(
                condition=(Q(ended_at__isnull=True) & Q(end_kind__isnull=True) & Q(ended_by__isnull=True))
                | (Q(ended_at__isnull=False) & Q(end_kind="author_edit") & Q(ended_by__isnull=True))
                | (Q(ended_at__isnull=False) & Q(end_kind="admin_unhide") & Q(ended_by__isnull=False)),
                name="review_hide_end_fields_match",
            ),
            # At most one current hide per review (a partial unique index in PostgreSQL)
            models.UniqueConstraint(
                fields=["review"], condition=Q(ended_at__isnull=True), name="review_one_current_hide"
            ),
        ]

    def __str__(self):
        return f"{self.hidden_at:%Y-%m-%d %H:%M} · {self.hidden_by}"
