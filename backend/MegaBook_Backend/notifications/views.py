from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import NotificationSerializer

NOT_FOUND = "پیدا نشد."


class NotificationPagination(PageNumberPagination):
    page_size = 20


class NotificationListView(generics.ListAPIView):
    """GET /notifications/?page=<n> -> my notifications of the last 90 days, newest first:
    { count, next, previous, results: [{ id, type, icon, text, link, created_at, read_at }] }

    Opening the list marks nothing as read. Before answering, my notifications older
    than 90 days are deleted (the command purge_old_notifications does it for everyone).
    """
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = NotificationPagination

    def get_queryset(self):
        # conversation and review: texts.py reads their parent ids for the link
        return services.visible_to(self.request.user).select_related("conversation", "review")

    def list(self, request, *args, **kwargs):
        services.purge_old(request.user)
        return super().list(request, *args, **kwargs)


class UnreadCountView(APIView):
    """GET /notifications/unread-count/ -> { count }. Polled by the bell, so one COUNT query."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"count": services.visible_to(request.user).unread().count()})


class MarkReadView(APIView):
    """POST /notifications/<id>/read/ -> 204. Someone else's (or an expired) one: 404."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        notification = services.visible_to(request.user).filter(pk=pk).first()
        if notification is None:
            return Response({"detail": NOT_FOUND}, status=status.HTTP_404_NOT_FOUND)
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MarkAllReadView(APIView):
    """POST /notifications/read-all/ -> { marked }: every unread one of mine is read now."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        marked = services.visible_to(request.user).unread().update(read_at=timezone.now())
        return Response({"marked": marked})
