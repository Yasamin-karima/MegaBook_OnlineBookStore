from rest_framework import serializers

from catalog.models import Book

from .models import LibraryItem

# Explicit field lists, like the public catalog serializers: never book_file (the
# paid content) or seller_share (DECISIONS 3.8)


class LibraryBookSerializer(serializers.ModelSerializer):
    """One bought book. `id` is the BOOK's id (the read route and the book page use it)."""

    id = serializers.IntegerField(source="book.id", read_only=True)
    title = serializers.CharField(source="book.title", read_only=True)
    authors = serializers.SlugRelatedField(source="book.authors", many=True, read_only=True, slug_field="name")
    cover = serializers.ImageField(source="book.cover", read_only=True)
    purchased_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = LibraryItem
        fields = ["id", "title", "authors", "cover", "purchased_at"]


class UploadedBookSerializer(serializers.ModelSerializer):
    """One of my uploads, in any status (pending and rejected ones too)."""

    authors = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")

    class Meta:
        model = Book
        fields = ["id", "title", "authors", "cover", "price", "status", "created_at"]
