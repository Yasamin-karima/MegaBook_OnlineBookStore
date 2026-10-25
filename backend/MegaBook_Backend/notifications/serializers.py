from rest_framework import serializers

from .models import Notification
from .texts import render


class NotificationSerializer(serializers.ModelSerializer):
    """The stored type + params, turned into text and link by texts.render.
    params and the source foreign keys themselves are not sent."""

    class Meta:
        model = Notification
        fields = ["id", "type", "created_at", "read_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data.update(render(instance, self.context.get("request")))
        return data
