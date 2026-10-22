from rest_framework import serializers

from .models import MAX_MESSAGE_LENGTH, Message
from .services import MESSAGE_EMPTY, MESSAGE_TOO_LONG

# The API's sender names, from the user's point of view: their own messages are "me"
SENDER_FOR_USER = {
    Message.Sender.USER: "me",
    Message.Sender.SUPPORT: "support",
    Message.Sender.SYSTEM: "system",
}


class MessageSerializer(serializers.ModelSerializer):
    """One message as the owner sees it. Never the author: support is only «پشتیبانی مگابوک»."""

    sender = serializers.SerializerMethodField()
    text = serializers.CharField(source="body")

    class Meta:
        model = Message
        fields = ["id", "sender", "text", "created_at"]

    def get_sender(self, message):
        return SENDER_FOR_USER[message.sender]


class NewMessageSerializer(serializers.Serializer):
    """The only input for a new message is its text. A `sender`, `kind` or `author`
    sent by the client is simply not a field here, so it's ignored."""

    text = serializers.CharField(
        max_length=MAX_MESSAGE_LENGTH,
        error_messages={
            "required": MESSAGE_EMPTY,
            "blank": MESSAGE_EMPTY,
            "null": MESSAGE_EMPTY,
            "max_length": MESSAGE_TOO_LONG,
        },
    )


def conversation_state(conversation):
    """{state, closed_kind, user_last_read_at} for the page; a missing conversation is open.
    Nothing internal (who closed it, the reason) is included."""
    if conversation is None:
        return {"state": "open", "closed_kind": None, "user_last_read_at": None}
    return {
        "state": "closed" if conversation.is_closed else "open",
        "closed_kind": conversation.closed_kind,
        "user_last_read_at": conversation.user_last_read_at,
    }

