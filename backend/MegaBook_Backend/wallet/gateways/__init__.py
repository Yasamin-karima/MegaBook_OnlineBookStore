"""Payment gateways for online top-ups.

A gateway module has one function, start_topup(user, amount), that returns a dict:
  {"status": "paid"}                              the mock: paid at once
  {"status": "redirect", "payment_url": "..."}    a real gateway: send the user there

A real gateway (e.g. Zarinpal) also needs a callback view: the gateway sends the
user back, the view asks the gateway to verify the payment, and only then calls
services.credit_gateway_payment(payment). The ledger logic doesn't change; only a
new module here and that callback view are added, and active_gateway() returns it.
"""
from django.conf import settings
from django.http import Http404

from . import mock


def active_gateway():
    """The gateway online top-ups use. For now only the mock, and only with DEBUG on.

    Checked on every request (not when urls.py is loaded), so it can't be left on by
    accident: with DEBUG off the endpoint behaves exactly as if it didn't exist.
    """
    if not settings.DEBUG:
        raise Http404
    return mock
