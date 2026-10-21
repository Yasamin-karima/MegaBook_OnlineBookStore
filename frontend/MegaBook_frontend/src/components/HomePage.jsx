import { useEffect, useState } from "react";
import CategoryTabs from "./CategoryTabs";
import BookSection from "./BookSection";
import RequestBanner from "./RequestBanner";
import { getBooks, getCategories } from "../api/catalog";

// یک کتاب از API را به propهایی که BookCard می‌شناسد تبدیل می‌کند.
// API: { id, title, authors: [نام‌ها], cover, price, category: {id, name} | null, ... }
function toCardProps(book) {
  return {
    id: book.id,
    title: book.title,
    author: book.authors.join("، "),
    image: book.cover, // آدرس کامل یا null
    price: book.price, // عدد؛ BookCard خودش آن را قالب‌بندی می‌کند
    badge: book.category?.name ?? null,
    // The logged-in user uploaded (later: bought) it: no cart button, a "read" link instead
    isOwned: Boolean(book.is_owned),
  };
}

// پیام وضعیت درخواست کتاب‌ها: یک بار به‌جای هر دو بخش نمایش داده می‌شود
function StatusMessage({ children, onRetry }) {
  return (
    <div className="my-16 px-4 flex flex-col items-center gap-4 text-center text-gray-600" role="status">
      <p>{children}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-full text-sm font-medium transition-colors duration-200"
        >
          تلاش دوباره
        </button>
      )}
    </div>
  );
}

export default function HomePage() {
  // --- دسته‌بندی‌ها (تب‌ها) ---
  const [categories, setCategories] = useState([]);
  const [categoriesStatus, setCategoriesStatus] = useState("loading"); // loading | error | success
  const [categoriesAttempt, setCategoriesAttempt] = useState(0); // با هر «تلاش دوباره» یکی زیاد می‌شود

  // --- کتاب‌ها ---
  const [activeCategory, setActiveCategory] = useState(null); // null یعنی «همه»
  const [books, setBooks] = useState([]);
  const [booksStatus, setBooksStatus] = useState("loading");
  const [booksAttempt, setBooksAttempt] = useState(0);

  // دسته‌بندی‌ها: وقتی صفحه باز می‌شود، و هر بار که «تلاش دوباره» زده شود
  useEffect(() => {
    // AbortController: اگر کامپوننت بسته شود یا effect دوباره اجرا شود، درخواست قبلی لغو می‌شود
    const controller = new AbortController();
    getCategories({ signal: controller.signal })
      .then((data) => {
        setCategories(data);
        setCategoriesStatus("success");
      })
      .catch(() => {
        if (!controller.signal.aborted) setCategoriesStatus("error");
      });
    return () => controller.abort();
  }, [categoriesAttempt]);

  // کتاب‌ها: وقتی صفحه باز می‌شود، وقتی تب عوض می‌شود، و هر بار که «تلاش دوباره» زده شود
  useEffect(() => {
    const controller = new AbortController();
    getBooks({ category: activeCategory, signal: controller.signal })
      .then((data) => {
        // فقط صفحه‌ی اول (۲۰ کتاب)؛ صفحه‌بندی در رابط کاربری فعلاً نداریم
        setBooks(data.results.map(toCardProps));
        setBooksStatus("success");
      })
      .catch(() => {
        // درخواستی که خودمان لغو کرده‌ایم (چون تب عوض شده) خطا حساب نمی‌شود
        if (!controller.signal.aborted) setBooksStatus("error");
      });
    return () => controller.abort();
  }, [activeCategory, booksAttempt]);

  // حالت «در حال بارگذاری» را همین‌جا، در لحظه‌ی کلیک، می‌گذاریم نه داخل effect
  const selectCategory = (id) => {
    if (id === activeCategory) return;
    setBooksStatus("loading");
    setActiveCategory(id);
  };

  const retryBooks = () => {
    setBooksStatus("loading");
    setBooksAttempt((n) => n + 1);
  };

  const retryCategories = () => {
    setCategoriesStatus("loading");
    setCategoriesAttempt((n) => n + 1);
  };

  // TODO: موقت. هنوز داده‌ی فروش (سفارش‌ها) نداریم، پس «پرفروش» فعلاً همان ۴ کتاب اول
  // فهرست جدیدترین‌هاست. وقتی مدل سفارش ساخته شد، این را با یک endpoint پرفروش‌ها عوض کنید.
  const bestsellers = books.slice(0, 4);

  return (
    <div className="z-0" dir="rtl">
      <CategoryTabs
        categories={categories}
        activeId={activeCategory}
        onSelect={selectCategory}
        status={categoriesStatus}
        onRetry={retryCategories}
      />

      {booksStatus === "loading" && <StatusMessage>در حال بارگذاری کتاب‌ها…</StatusMessage>}

      {booksStatus === "error" && (
        <StatusMessage onRetry={retryBooks}>دریافت کتاب‌ها انجام نشد.</StatusMessage>
      )}

      {booksStatus === "success" && books.length === 0 && (
        <StatusMessage>کتابی در این دسته نیست</StatusMessage>
      )}

      {booksStatus === "success" && books.length > 0 && (
        <>
          <BookSection title="کتاب‌های پرفروش" books={bestsellers} />
          <BookSection title="تازه‌ها" books={books} />
        </>
      )}

      <RequestBanner />

    </div>
  );
}
