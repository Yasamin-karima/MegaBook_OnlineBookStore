from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from .models import EMAIL_OR_PHONE_REQUIRED, EMAIL_TAKEN, PHONE_TAKEN
from .phone import PHONE_INVALID, InvalidPhone, normalize_phone
from .serializers import LOGIN_FAILED

Account = get_user_model()

PASSWORD = 'Str0ng-Passw0rd!'


def make_user(**fields):
    return Account.objects.create_user(first_name='Sara', last_name='Ahmadi', password=PASSWORD, **fields)


class PhoneNormalizationTests(TestCase):
    def test_all_accepted_formats_give_the_same_value(self):
        inputs = [
            '09121234567',
            '9121234567',
            '+989121234567',
            '00989121234567',
            '989121234567',
            '0912 123 4567',
            '0912-123-4567',
            '+98 912 123 4567',
            '۰۹۱۲۱۲۳۴۵۶۷',      # Persian digits
            '٠٩١٢١٢٣٤٥٦٧',      # Arabic digits
            '+۹۸ ۹۱۲ ۱۲۳ ۴۵۶۷',
        ]
        for raw in inputs:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_phone(raw), '09121234567')

    def test_invalid_numbers_are_rejected(self):
        for raw in ['', '0912123456', '091212345678', '02112345678', '+18005550100', '09121234abc', '8121234567']:
            with self.subTest(raw=raw):
                with self.assertRaises(InvalidPhone):
                    normalize_phone(raw)

    def test_model_stores_normalized_phone(self):
        user = make_user(phone='+98 912 123 4567')
        user.refresh_from_db()
        self.assertEqual(user.phone, '09121234567')

    def test_model_rejects_invalid_phone(self):
        with self.assertRaises(ValidationError):
            make_user(phone='12345')


class EmailNormalizationTests(TestCase):
    def test_whole_address_is_lowercased_and_trimmed(self):
        user = make_user(email='  Ali.Rezaei@Example.COM ')
        user.refresh_from_db()
        self.assertEqual(user.email, 'ali.rezaei@example.com')

    def test_empty_email_is_stored_as_null(self):
        user = make_user(email='', phone='09121234567')
        user.refresh_from_db()
        self.assertIsNone(user.email)

    def test_clean_keeps_empty_email_as_null(self):
        # AbstractUser.clean() turns None into "" via normalize_email; ours must undo that
        user = Account(first_name='a', last_name='b', email=None, phone='09121234567')
        user.clean()
        self.assertIsNone(user.email)


class EmailOrPhoneRuleTests(TestCase):
    def test_two_users_without_email(self):
        make_user(phone='09121111111')
        make_user(phone='09122222222')
        self.assertEqual(Account.objects.filter(email__isnull=True).count(), 2)

    def test_two_users_without_phone(self):
        make_user(email='a@example.com')
        make_user(email='b@example.com')
        self.assertEqual(Account.objects.filter(phone__isnull=True).count(), 2)

    def test_both_email_and_phone_allowed(self):
        user = make_user(email='a@example.com', phone='09121234567')
        self.assertEqual((user.email, user.phone), ('a@example.com', '09121234567'))

    def test_manager_rejects_user_without_email_or_phone(self):
        with self.assertRaises(ValidationError) as ctx:
            make_user(email='', phone='  ')
        self.assertIn(EMAIL_OR_PHONE_REQUIRED, ctx.exception.messages)
        self.assertFalse(Account.objects.exists())

    def test_database_constraint_rejects_user_without_email_or_phone(self):
        # QuerySet.update() skips save(), so only the CheckConstraint can stop it
        user = make_user(email='a@example.com')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Account.objects.filter(pk=user.pk).update(email=None)

    def test_database_constraint_rejects_empty_string_and_unnormalized_phone(self):
        user = make_user(email='a@example.com')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Account.objects.filter(pk=user.pk).update(email='')
        # Fits the 11-character column but isn't in the 09xxxxxxxxx form
        with self.assertRaises(IntegrityError), transaction.atomic():
            Account.objects.filter(pk=user.pk).update(phone='9121234567')


class NameRuleTests(TestCase):
    def test_names_are_trimmed(self):
        user = Account.objects.create_user(
            email='a@example.com', first_name='  سارا ', last_name=' احمدی  ', password=PASSWORD
        )
        user.refresh_from_db()
        self.assertEqual((user.first_name, user.last_name), ('سارا', 'احمدی'))

    def test_manager_rejects_empty_or_space_only_names(self):
        for first, last in [('', 'Ahmadi'), ('Sara', '   '), ('', '')]:
            with self.subTest(first=first, last=last):
                with self.assertRaises(ValidationError):
                    Account.objects.create_user(email='a@example.com', first_name=first, last_name=last)
        self.assertFalse(Account.objects.exists())

    def test_database_constraint_rejects_empty_or_space_only_names(self):
        user = make_user(email='a@example.com')
        for fields in [{'first_name': ''}, {'first_name': '   '}, {'last_name': ''}, {'last_name': ' \t '}]:
            with self.subTest(fields=fields):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    Account.objects.filter(pk=user.pk).update(**fields)


class DuplicateTests(TestCase):
    def test_duplicate_email_with_different_case_is_rejected(self):
        make_user(email='sara@example.com')
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_user(email='SARA@Example.com')

    def test_duplicate_phone_in_another_format_is_rejected(self):
        make_user(phone='09121234567')
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_user(phone='+98912 123 4567')


class SuperuserTests(TestCase):
    def test_create_superuser_requires_email(self):
        with self.assertRaises(ValueError):
            Account.objects.create_superuser(email='', password=PASSWORD, first_name='a', last_name='b')

    def test_create_superuser(self):
        admin = Account.objects.create_superuser(
            email='Admin@Example.com', password=PASSWORD, first_name='a', last_name='b'
        )
        self.assertTrue(admin.is_staff and admin.is_superuser)
        self.assertEqual(Account.objects.get_by_natural_key('ADMIN@example.com'), admin)


class RegisterApiTests(APITestCase):
    def register(self, **overrides):
        data = {'first_name': 'سارا', 'last_name': 'احمدی', 'password': PASSWORD, **overrides}
        return self.client.post('/accounts/register/', data, format='json')

    def test_register_with_email(self):
        res = self.register(email='Sara@Example.com')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertEqual(res.data['user']['email'], 'sara@example.com')
        self.assertIsNone(res.data['user']['phone'])
        self.assertNotIn('password', res.data['user'])

        user = Account.objects.get(email='sara@example.com')
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.check_password(PASSWORD))

    def test_register_with_phone(self):
        res = self.register(phone='+98 912 123 4567', email='')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['user']['phone'], '09121234567')
        self.assertIsNone(res.data['user']['email'])

    def test_neither_email_nor_phone(self):
        res = self.register(email='', phone='')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['non_field_errors'], [EMAIL_OR_PHONE_REQUIRED])

    def test_invalid_phone(self):
        res = self.register(phone='12345')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['phone'], [PHONE_INVALID])

    def test_email_taken(self):
        self.register(email='sara@example.com')
        res = self.register(email='SARA@example.com')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['email'], [EMAIL_TAKEN])

    def test_phone_taken_in_another_format(self):
        self.register(phone='09121234567')
        res = self.register(phone='+989121234567')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['phone'], [PHONE_TAKEN])

    def test_names_required(self):
        res = self.register(email='a@example.com', first_name='', last_name='')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['first_name'], ['نام را وارد کنید.'])
        self.assertEqual(res.data['last_name'], ['نام خانوادگی را وارد کنید.'])

    def test_weak_password_gets_persian_messages(self):
        res = self.register(email='a@example.com', password='123')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('رمز عبور باید دست‌کم ۸ کاراکتر باشد.', res.data['password'])
        self.assertIn('رمز عبور نباید فقط عدد باشد.', res.data['password'])

    def test_password_similar_to_phone_rejected(self):
        res = self.register(phone='09121234567', password='09121234567x')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('رمز عبور خیلی شبیه نام، ایمیل یا شماره موبایل شماست.', res.data['password'])


class LoginApiTests(APITestCase):
    def setUp(self):
        make_user(email='sara@example.com', phone='09121234567')

    def login(self, identifier, password=PASSWORD):
        return self.client.post('/accounts/login/', {'identifier': identifier, 'password': password}, format='json')

    def test_login_with_email(self):
        res = self.login('Sara@Example.com')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertEqual(res.data['user']['email'], 'sara@example.com')

    def test_login_with_phone(self):
        self.assertEqual(self.login('09121234567').status_code, status.HTTP_200_OK)

    def test_login_with_differently_formatted_phone(self):
        for identifier in ['+98 912 123 4567', '۰۹۱۲۱۲۳۴۵۶۷', '9121234567']:
            with self.subTest(identifier=identifier):
                self.assertEqual(self.login(identifier).status_code, status.HTTP_200_OK)

    def test_wrong_password(self):
        res = self.login('sara@example.com', password='wrong')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data['detail'], LOGIN_FAILED)

    def test_unknown_account_gets_the_same_message(self):
        for identifier in ['nobody@example.com', '09350000000', 'not-a-phone']:
            with self.subTest(identifier=identifier):
                res = self.login(identifier)
                self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
                self.assertEqual(res.data['detail'], LOGIN_FAILED)

    def test_inactive_user_cannot_log_in(self):
        Account.objects.filter(email='sara@example.com').update(is_active=False)
        res = self.login('sara@example.com')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data['detail'], LOGIN_FAILED)

    def test_missing_identifier(self):
        res = self.client.post('/accounts/login/', {'password': PASSWORD}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['identifier'], ['ایمیل یا شماره موبایل را وارد کنید.'])

    def test_me(self):
        access = self.login('09121234567').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        me = self.client.get('/accounts/me/')
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        self.assertEqual(me.data['phone'], '09121234567')

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get('/accounts/me/').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_and_logout(self):
        refresh = self.login('sara@example.com').data['refresh']
        res = self.client.post('/accounts/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)

        res = self.client.post('/accounts/logout/', {'refresh': refresh}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # a logged-out refresh token can't be used anymore
        res = self.client.post('/accounts/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


class AccountUpdateApiTests(APITestCase):
    def setUp(self):
        self.user = make_user(email='sara@example.com')
        self.client.force_authenticate(self.user)

    def patch(self, **data):
        return self.client.patch('/accounts/me/', data, format='json')

    def test_requires_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.patch(first_name='x').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_put_not_allowed(self):
        res = self.client.put('/accounts/me/', {'first_name': 'x'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_change_names_without_password(self):
        res = self.patch(first_name=' علی ', last_name='رضایی')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual((res.data['first_name'], res.data['last_name']), ('علی', 'رضایی'))

    def test_blank_name_rejected(self):
        res = self.patch(first_name='   ')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['first_name'], ['نام را وارد کنید.'])

    def test_add_phone_needs_current_password(self):
        res = self.patch(phone='09121234567')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('current_password', res.data)

        res = self.patch(phone='09121234567', current_password='wrong')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['current_password'], ['رمز عبور فعلی اشتباه است.'])

        res = self.patch(phone='+98 912 123 4567', current_password=PASSWORD)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['phone'], '09121234567')
        self.assertEqual(res.data['email'], 'sara@example.com')

    def test_can_log_in_with_added_phone(self):
        self.patch(phone='09121234567', current_password=PASSWORD)
        res = self.client.post('/accounts/login/', {'identifier': '09121234567', 'password': PASSWORD}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_same_values_need_no_password(self):
        # Sending the current email again (in another case) is not a change
        res = self.patch(email='SARA@example.com', first_name='Sara')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_remove_one_when_the_other_remains(self):
        self.patch(phone='09121234567', current_password=PASSWORD)
        res = self.patch(email='', current_password=PASSWORD)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNone(res.data['email'])
        self.user.refresh_from_db()
        self.assertIsNone(self.user.email)

    def test_cannot_remove_both(self):
        res = self.patch(email=None, current_password=PASSWORD)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('non_field_errors', res.data)

    def test_staff_must_keep_email(self):
        self.user.is_staff = True
        self.user.phone = '09121234567'
        self.user.save()
        res = self.patch(email='', current_password=PASSWORD)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['email'], ['حساب مدیر باید ایمیل داشته باشد.'])

    def test_taken_email_and_phone_rejected(self):
        make_user(email='other@example.com', phone='09351112233')
        res = self.patch(email='Other@example.com', current_password=PASSWORD)
        self.assertEqual(res.data['email'], [EMAIL_TAKEN])
        res = self.patch(phone='+989351112233', current_password=PASSWORD)
        self.assertEqual(res.data['phone'], [PHONE_TAKEN])

    def test_invalid_phone_rejected(self):
        res = self.patch(phone='123', current_password=PASSWORD)
        self.assertEqual(res.data['phone'], [PHONE_INVALID])


class AdminPagesTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create_superuser(
            email='admin@example.com', password=PASSWORD, first_name='a', last_name='b'
        )
        self.client.force_login(self.admin)

    def test_admin_login_with_email(self):
        self.client.logout()
        res = self.client.post(
            '/admin/login/', {'username': 'admin@example.com', 'password': PASSWORD, 'next': '/admin/'}
        )
        self.assertRedirects(res, '/admin/')

    def test_user_list_add_and_change_pages_open(self):
        make_user(phone='09121234567')
        for url in ['/admin/accounts/account/', '/admin/accounts/account/add/',
                    f'/admin/accounts/account/{self.admin.pk}/change/',
                    '/admin/accounts/account/?q=0912']:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_admin_add_form_normalizes_phone(self):
        res = self.client.post('/admin/accounts/account/add/', {
            'email': '', 'phone': '+98 935 111 2233', 'first_name': 'Ali', 'last_name': 'Rezaei',
            'usable_password': 'true', 'password1': PASSWORD, 'password2': PASSWORD,
        })
        self.assertEqual(res.status_code, 302)
        self.assertTrue(Account.objects.filter(phone='09351112233', email__isnull=True).exists())

    def test_admin_add_form_requires_email_or_phone(self):
        res = self.client.post('/admin/accounts/account/add/', {
            'email': '', 'phone': '', 'first_name': 'Ali', 'last_name': 'Rezaei',
            'usable_password': 'true', 'password1': PASSWORD, 'password2': PASSWORD,
        })
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, EMAIL_OR_PHONE_REQUIRED)
