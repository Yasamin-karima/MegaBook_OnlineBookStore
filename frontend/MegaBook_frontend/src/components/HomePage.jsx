import CategoryTabs from "./CategoryTabs";
import BookSection from "./BookSection";
import RequestBanner from "./RequestBanner";

// Placeholder data — replace image paths and values with real API data later
const bestsellers = [
  {
    id: 1,
    title: "Minimalist Geometry",
    author: "Vance Elena",
    price: 24.99,
    rating: 4.8,
    image: "/book-covers/249748.jpg",
    badge: "پرفروش",
  },
  {
    id: 2,
    title: "High Contrast Design",
    author: "Marcus Aurelius",
    price: 29.5,
    rating: 4.5,
    image: "/book-covers/301984.jpg",
    badge: "پرفروش",
  },
];

const newArrivals = [
  {
    id: 3,
    title: "Minimalist Geometry",
    author: "Vance Elena",
    price: 24.99,
    rating: 4.8,
    image: "/book-covers/314226.jpg",
    badge: "جدید",
  },
  {
    id: 4,
    title: "High Contrast Design",
    author: "Marcus Aurelius",
    price: 29.5,
    rating: 4.5,
    image: "/book-covers/329872.jpg",
    badge: "جدید",
  },
  {
    id: 5,
    title: "The Playful Path",
    author: "Sunny Day",
    price: 18.0,
    rating: 4.6,
    image: "/book-covers/336951.jpg",
    badge: "پرفروش",
  },
  {
    id: 6,
    title: "Midnight Textures",
    author: "D. S. Dark",
    price: 32.99,
    rating: 4.7,
    image: "/book-covers/336951.jpg",
    badge: "پرفروش",
  },
  {
    id: 7,
    title: "Modern Fiction",
    author: "Jane Doe",
    price: 21.99,
    rating: 4.2,
    image: "/book-covers/249748.jpg",
    badge: "جدید",
  },
  {
    id: 8,
    title: "Abstract Logic",
    author: "Alan Turing",
    price: 27.0,
    rating: 4.3,
    image: "/book-covers/301984.jpg",
    badge: "جدید",
  },
];

export default function HomePage() {
  return (
    <div className="z-0" dir="rtl">
      <CategoryTabs />

      <BookSection title="کتاب‌های پرفروش" books={bestsellers} />
      <BookSection title="تازه‌ها" books={newArrivals} />

      <RequestBanner />

    </div>
  );
}