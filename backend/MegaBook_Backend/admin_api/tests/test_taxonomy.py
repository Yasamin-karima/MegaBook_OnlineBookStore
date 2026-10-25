from catalog.models import Book, Category, Tag

from .helpers import AdminApiTestCase, Make


class TaxonomyTests(AdminApiTestCase):
    def test_create_rename_delete_categories(self):
        response = self.client.post("/admin-api/categories/", {"name": "  شعر   نو "})
        self.assertEqual((response.status_code, response.data["name"]), (201, "شعر نو"))
        self.assertEqual(self.client.post("/admin-api/categories/", {"name": "شعر نو"}).status_code, 400)
        self.assertEqual(self.client.post("/admin-api/categories/", {"name": " "}).status_code, 400)
        pk = response.data["id"]

        book = Make.book(Make.user(), category=Category.objects.get(pk=pk))
        listed = self.client.get("/admin-api/categories/").data
        self.assertEqual([(c["name"], c["book_count"]) for c in listed], [("شعر نو", 1)])

        self.assertEqual(self.client.patch(f"/admin-api/categories/{pk}/", {"name": "شعر"}).data["name"], "شعر")
        self.assertEqual(self.client.delete(f"/admin-api/categories/{pk}/").status_code, 204)
        book.refresh_from_db()
        self.assertIsNone(book.category)  # the book stays, without a category

    def test_tags(self):
        book = Make.book(Make.user())
        tag = Tag.objects.create(name="کلاسیک")
        book.tags.add(tag)
        self.assertEqual(self.client.get("/admin-api/tags/").data, [{"id": tag.pk, "name": "کلاسیک", "book_count": 1}])
        self.assertEqual(self.client.post("/admin-api/tags/", {"name": "x" * 51}).status_code, 400)
        self.assertEqual(self.client.delete(f"/admin-api/tags/{tag.pk}/").status_code, 204)
        self.assertEqual(book.tags.count(), 0)
        self.assertTrue(Book.objects.filter(pk=book.pk).exists())
