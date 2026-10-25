from django.urls import get_resolver
from rest_framework.test import APITestCase

from .helpers import Make


def every_admin_api_url():
    """Every /admin-api/ route, with 1 for each <int:pk>."""
    from admin_api import urls

    paths = []
    for pattern in urls.urlpatterns:
        route = str(pattern.pattern).replace("<int:pk>", "1")
        paths.append(f"/admin-api/{route}")
    return paths


class AccessTests(APITestCase):
    """Every endpoint answers 404 to anyone who isn't staff, whatever the method,
    so nothing tells them the admin API exists."""

    def setUp(self):
        self.user = Make.user()
        self.admin = Make.admin()
        Make.book(self.user)  # so /books/1/-like URLs could exist

    def test_routes_are_found(self):
        get_resolver()  # the URLconf loads
        self.assertTrue(every_admin_api_url())

    def assert_404_for_all(self):
        for url in every_admin_api_url():
            for method in ("get", "post", "patch", "delete"):
                response = getattr(self.client, method)(url, {}, format="json")
                with self.subTest(url=url, method=method):
                    self.assertEqual(response.status_code, 404)

    def test_guest_gets_404(self):
        self.assert_404_for_all()

    def test_normal_user_gets_404(self):
        self.client.force_authenticate(self.user)
        self.assert_404_for_all()

    def test_inactive_staff_gets_404(self):
        self.admin.is_active = False
        self.admin.save()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/admin-api/books/").status_code, 404)

    def test_staff_without_superuser_has_full_access(self):
        # No separate roles: any staff member reaches everything, money included
        staff = Make.user(is_staff=True)
        self.client.force_authenticate(staff)
        lists = [url for url in every_admin_api_url() if "/1/" not in url]
        for url in lists:
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_expired_token_still_gets_401_so_the_frontend_can_refresh(self):
        response = self.client.get("/admin-api/books/", HTTP_AUTHORIZATION="Bearer not-a-real-token")
        self.assertEqual(response.status_code, 401)
