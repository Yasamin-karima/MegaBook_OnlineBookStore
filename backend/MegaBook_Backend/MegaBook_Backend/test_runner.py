import shutil
import tempfile

from django.conf import settings
from django.test.runner import DiscoverRunner


class TempPrivateMediaRunner(DiscoverRunner):
    """Runs the tests with PRIVATE_MEDIA_ROOT in a temporary folder, deleted afterwards,
    so test uploads never land in the real private_media/."""

    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        self._private_media = tempfile.mkdtemp(prefix="megabook-private-")
        self._original_private_media = settings.PRIVATE_MEDIA_ROOT
        settings.PRIVATE_MEDIA_ROOT = self._private_media

    def teardown_test_environment(self, **kwargs):
        settings.PRIVATE_MEDIA_ROOT = self._original_private_media
        shutil.rmtree(self._private_media, ignore_errors=True)
        super().teardown_test_environment(**kwargs)
