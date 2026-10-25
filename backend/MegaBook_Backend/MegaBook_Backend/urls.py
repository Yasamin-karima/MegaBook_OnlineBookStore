"""
URL configuration for MegaBook_Backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('accounts/', include('accounts.urls')),
    # A book's reviews: /catalog/books/<id>/reviews/ (the reviews app)
    path('catalog/books/<int:book_id>/reviews/', include('reviews.urls')),
    path('catalog/', include('catalog.urls')),
    path('book-requests/', include('book_requests.urls')),
    path('wallet/', include('wallet.urls')),
    path('cart/', include('cart.urls')),
    path('orders/', include('orders.urls')),
    path('library/', include('library.urls')),
    path('dashboard/', include('dashboard.urls')),
    path('support/', include('support.urls')),
    path('notifications/', include('notifications.urls')),
]

# فایل‌های آپلودشده (جلد، PDF) را در حالت توسعه خود جنگو سرو می‌کند.
# static() وقتی DEBUG خاموش باشد چیزی اضافه نمی‌کند؛ در production باید وب‌سرور این کار را بکند.
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
