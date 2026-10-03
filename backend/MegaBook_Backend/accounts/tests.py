from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

Account = get_user_model()


class AuthFlowTests(APITestCase):
    password = 'Str0ng-Passw0rd!'

    def register(self, **overrides):
        data = {'username': 'sara', 'email': 'sara@example.com', 'password': self.password, **overrides}
        return self.client.post('/accounts/register/', data, format='json')

    def test_register_creates_user_with_hashed_password_and_returns_tokens(self):
        res = self.register()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertEqual(res.data['user']['username'], 'sara')
        self.assertNotIn('password', res.data['user'])

        user = Account.objects.get(username='sara')
        self.assertNotEqual(user.password, self.password)
        self.assertTrue(user.check_password(self.password))

    def test_register_rejects_duplicate_email_case_insensitive(self):
        self.register()
        res = self.register(username='other', email='SARA@example.com')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', res.data)

    def test_register_rejects_duplicate_username(self):
        self.register()
        res = self.register(email='other@example.com')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('username', res.data)

    def test_register_rejects_weak_password(self):
        res = self.register(password='123')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password', res.data)

    def test_login_and_me(self):
        self.register()
        res = self.client.post('/accounts/login/', {'username': 'sara', 'password': self.password}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['user']['email'], 'sara@example.com')

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        me = self.client.get('/accounts/me/')
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        self.assertEqual(me.data['username'], 'sara')

    def test_login_wrong_password(self):
        self.register()
        res = self.client.post('/accounts/login/', {'username': 'sara', 'password': 'wrong'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get('/accounts/me/').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_and_logout(self):
        refresh = self.register().data['refresh']
        res = self.client.post('/accounts/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)

        res = self.client.post('/accounts/logout/', {'refresh': refresh}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # a logged-out refresh token can't be used anymore
        res = self.client.post('/accounts/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
