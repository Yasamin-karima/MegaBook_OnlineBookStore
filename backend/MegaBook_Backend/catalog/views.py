from rest_framework import generics, permissions
from rest_framework.parsers import FormParser, MultiPartParser

from .models import Category
from .serializers import BookCreateSerializer, CategorySerializer


class BookCreateView(generics.CreateAPIView):
    """POST multipart/form-data -> کتاب جدید با وضعیت «در انتظار تایید» می‌سازد."""
    serializer_class = BookCreateSerializer
    permission_classes = [permissions.IsAuthenticated]
    # فرم فایل دارد، پس داده به‌جای JSON به شکل multipart می‌آید
    parser_classes = [MultiPartParser, FormParser]

    def perform_create(self, serializer):
        # بارگذارنده همیشه کاربر واردشده است، نه چیزی که کلاینت بفرستد
        serializer.save(uploaded_by=self.request.user)


class CategoryListView(generics.ListAPIView):
    """GET -> فهرست دسته‌بندی‌ها [{id, name}] برای منوی «موضوع» فرم."""
    queryset = Category.objects.order_by("name")
    serializer_class = CategorySerializer
    permission_classes = [permissions.AllowAny]
    # توکن (حتی منقضی) نادیده گرفته شود؛ این فهرست عمومی است
    authentication_classes = []
