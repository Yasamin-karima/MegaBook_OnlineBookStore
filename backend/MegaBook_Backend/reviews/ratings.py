"""A book's average rating and number of reviews: computed, never stored (DECISIONS 13.4).

Only visible reviews count (a hidden review counts for nobody, not even its author).
Each number is a correlated subquery over the reviews table, not a JOIN: a JOIN
combined with other relations in the same query (order items, library items,
search over authors) would repeat each review once per joined row and inflate both
the count and, for a skewed set, the average.
"""
from django.db.models import Avg, Count, FloatField, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

from .models import Review


def annotate_rating(queryset):
    """Adds rating_count (0 when none) and rating_average (None when none) to every book."""
    visible = Review.objects.visible().filter(book=OuterRef("pk")).order_by().values("book")
    return queryset.annotate(
        rating_count=Coalesce(
            Subquery(visible.annotate(n=Count("pk")).values("n"), output_field=IntegerField()),
            Value(0),
        ),
        rating_average=Subquery(visible.annotate(avg=Avg("rating")).values("avg"), output_field=FloatField()),
    )
