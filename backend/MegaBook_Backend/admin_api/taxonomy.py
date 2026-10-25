"""Categories and tags: list (with how many books use each), create, rename, delete.

Categories are the home page's tabs, so only admins create them. Users still create
tags freely when they upload (the upload form already does get_or_create); this page
is where admins clean those up.

Deleting a category leaves its books without one (SET_NULL on Book.category);
deleting a tag only removes it from its books.
"""
import re

from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response

from catalog.models import Category, Tag

from .common import StaffView

NAME_REQUIRED = "نام را بنویسید."
NAME_TAKEN = "این نام از قبل وجود دارد."


def clean_name(value):
    """Trimmed, with runs of spaces collapsed to one."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def make_serializer(model):
    max_length = model._meta.get_field("name").max_length

    class NameSerializer(serializers.Serializer):
        name = serializers.CharField(
            max_length=max_length,
            error_messages={
                "required": NAME_REQUIRED, "blank": NAME_REQUIRED, "null": NAME_REQUIRED,
                "max_length": f"نام حداکثر {max_length} نویسه است.",
            },
        )

        def validate_name(self, value):
            value = clean_name(value)
            if not value:
                raise serializers.ValidationError(NAME_REQUIRED)
            others = model.objects.filter(name=value)
            if self.instance is not None:
                others = others.exclude(pk=self.instance.pk)
            if others.exists():
                raise serializers.ValidationError(NAME_TAKEN)
            return value

    return NameSerializer


def item(obj):
    return {"id": obj.pk, "name": obj.name, "book_count": getattr(obj, "book_count", 0)}


class TaxonomyListView(StaffView):
    """GET  /admin-api/<categories|tags>/ -> [{ id, name, book_count }] (one query)
    POST /admin-api/<categories|tags>/ { name } -> 201 the new item"""

    model = None

    def get(self, request):
        rows = self.model.objects.annotate(book_count=Count("books")).order_by("name")
        return Response([item(row) for row in rows])

    def post(self, request):
        serializer = make_serializer(self.model)(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = self.model.objects.create(name=serializer.validated_data["name"])
        return Response(item(obj), status=status.HTTP_201_CREATED)


class TaxonomyItemView(StaffView):
    """PATCH  /admin-api/<categories|tags>/<id>/ { name } -> the renamed item
    DELETE /admin-api/<categories|tags>/<id>/ -> 204"""

    model = None

    def get_object(self, pk):
        return get_object_or_404(self.model.objects.annotate(book_count=Count("books")), pk=pk)

    def patch(self, request, pk):
        obj = self.get_object(pk)
        serializer = make_serializer(self.model)(obj, data=request.data)
        serializer.is_valid(raise_exception=True)
        obj.name = serializer.validated_data["name"]
        obj.save(update_fields=["name"])
        return Response(item(obj))

    def delete(self, request, pk):
        self.get_object(pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


CATEGORY_VIEWS = {"model": Category}
TAG_VIEWS = {"model": Tag}
