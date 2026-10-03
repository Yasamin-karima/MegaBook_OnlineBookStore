from django.contrib import admin
from .models import Book, Category, Person, Publisher, Tag

admin.site.register([Book, Category, Person, Publisher, Tag])