"""A fake gateway for development: every payment succeeds at once.

Goes through the same GatewayPayment row and services.credit_gateway_payment that a
real gateway will use, so replacing it touches nothing in the ledger logic.
Only reachable through gateways.active_gateway(), which requires DEBUG.
"""
import uuid

from .. import services
from ..models import GatewayPayment

NAME = "mock"


def start_topup(user, amount):
    payment = GatewayPayment.objects.create(user=user, amount=amount, gateway=NAME, reference=uuid.uuid4().hex)
    # A real gateway would redirect here and verify in its callback; the mock is
    # "verified" immediately
    services.credit_gateway_payment(payment)
    return {"status": "paid"}
