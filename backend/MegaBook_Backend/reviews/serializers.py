from rest_framework import serializers

from catalog.serializers import messages

from .models import BODY_TOO_LONG, MAX_BODY_LENGTH, MAX_RATING, MIN_RATING, RATING_RANGE, Review

# Explicit field lists only, never "__all__": the moderation fields (checked_*, hidden_by,
# the hide history) must never reach the API, and hidden/hide_reason only the author.


def author_name(user):
    """«سارا ج.»: first name and the first letter of the last name. Never email or phone.
    Both names are required on every account (accounts.Account constraints)."""
    return f"{user.first_name} {user.last_name[:1]}."


class ReviewSerializer(serializers.ModelSerializer):
    """A review as everyone sees it (the public list)."""

    author_name = serializers.SerializerMethodField()
    is_edited = serializers.BooleanField(read_only=True)

    class Meta:
        model = Review
        fields = ["id", "rating", "body", "author_name", "created_at", "is_edited"]

    def get_author_name(self, review):
        return author_name(review.user)


class MyReviewSerializer(ReviewSerializer):
    """The author's own review: also whether an admin hid it, and why. Not who hid it."""

    is_hidden = serializers.BooleanField(read_only=True)

    class Meta(ReviewSerializer.Meta):
        fields = ReviewSerializer.Meta.fields + ["is_hidden", "hide_reason"]


class ReviewWriteSerializer(serializers.Serializer):
    """What the author sends to create or edit: { rating, body? }."""

    rating = serializers.IntegerField(
        min_value=MIN_RATING,
        max_value=MAX_RATING,
        error_messages=messages(
            required="امتیاز را انتخاب کنید.",
            null="امتیاز را انتخاب کنید.",
            invalid=RATING_RANGE,
            min_value=RATING_RANGE,
            max_value=RATING_RANGE,
        ),
    )
    # Optional; "" removes the text. Trimmed, so only spaces counts as no text.
    body = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=MAX_BODY_LENGTH,
        error_messages=messages(max_length=BODY_TOO_LONG),
    )
