import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LuBookOpen, LuCheck, LuShoppingCart } from 'react-icons/lu';
import useCart from '../hooks/useCart';
import { formatPrice } from '../utils/format';

//   id:    شناسه‌ی کتاب؛ کلیک روی کارت به /books/:id می‌رود
//   image: آدرس کامل جلد یا null
//   badge: نام دسته‌بندی یا null (اگر null باشد، badge نمایش داده نمی‌شود)
//   isOwned: کاربر این کتاب را دارد (بارگذاری یا خریده)؛ به‌جای دکمه‌ی سبد، لینک «خواندن»
//
// کلیک روی کارت: عنوان یک Link واقعی است و با after:absolute after:inset-0 ناحیه‌ی کلیکش
// روی کل کارت کشیده می‌شود (کارت relative است). دکمه‌ی سبد خرید با relative z-10 یک لایه
// بالاتر از آن ناحیه است، پس کلیک روی دکمه به لینک نمی‌رسد و صفحه عوض نمی‌شود.
// دکمه داخل <a> گذاشته نشده چون عنصر تعاملی داخل لینک در HTML مجاز نیست.
const BookCard = ({ id, title, author, price, image, badge, isOwned = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  // Every card reads the one shared cart (CartProvider), so all cards and the
  // navbar badge agree without passing the cart down as props
  const { isInCart, isPending, addToCart } = useCart();
  // The backend's Persian reason when adding fails; shown under the price for a few seconds
  const [message, setMessage] = useState('');
  const messageTimer = useRef(null);
  useEffect(() => () => clearTimeout(messageTimer.current), []);

  async function handleAdd() {
    const result = await addToCart(id);
    if (result.code === 'login_required') {
      navigate('/login', { state: { from: location } });
    } else if (!result.ok && result.message) {
      clearTimeout(messageTimer.current);
      setMessage(result.message);
      messageTimer.current = setTimeout(() => setMessage(''), 4000);
    }
  }

  // اگر آدرس جلد باشد ولی تصویر لود نشود (فایل پاک شده و ...)، همان جای‌خالی را نشان می‌دهیم
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = image && !imageFailed;

  return (
    <div className="relative w-64 bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-300">
      {/* Book Cover Image */}
      <div className="relative h-80 bg-gray-200">
        {showImage ? (
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          // جای‌خالی خنثی برای کتاب بدون جلد
          <div className="w-full h-full flex items-center justify-center text-gray-400" aria-hidden="true">
            <LuBookOpen className="w-16 h-16" />
          </div>
        )}
        {badge && (
          <div className="absolute top-3 left-3 bg-blue-600 backdrop-blur-sm px-2 py-1 rounded-lg text-sm font-semibold text-white shadow-md flex items-center gap-1">
            <span>{badge}</span>
          </div>
        )}
      </div>

      {/* Book Details */}
      <div className="p-4">
        {/* Title — dir="auto" تا عنوان انگلیسی در کارت راست‌چین درست نمایش داده شود */}
        <h3 dir="auto" className="text-lg font-bold text-gray-900 mb-1 line-clamp-2">
          <Link
            to={`/books/${id}`}
            className="after:absolute after:inset-0 focus:outline-none focus-visible:underline"
          >
            {title}
          </Link>
        </h3>

        {/* Author */}
        <p dir="auto" className="text-sm text-gray-600 mb-2">
          {author}
        </p>

        {/* Price */}
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-gray-900">{formatPrice(price)}</span>
          {/* relative z-10: بالای ناحیه‌ی کلیک کارت، تا کلیک روی دکمه صفحه را عوض نکند. */}
          {isOwned ? (
            // The user can already read it: the book page has the "read the book" button
            <Link
              to={`/books/${id}`}
              aria-label="خواندن کتاب"
              className="relative z-10 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors duration-200"
            >
              <LuBookOpen className='text-2xl' />
            </Link>
          ) : isInCart(id) ? (
            <Link
              to="/cart"
              aria-label="در سبد خرید · مشاهده سبد"
              className="relative z-10 border-2 border-blue-600 text-blue-600 hover:bg-blue-50 px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-200"
            >
              <LuCheck className='text-2xl' />
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              disabled={isPending(id)}
              aria-label="افزودن به سبد خرید"
              className="relative z-10 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-wait text-white px-4 py-2 rounded-full text-sm font-medium transition-colors duration-200"
            >
              <LuShoppingCart className='text-2xl' />
            </button>
          )}
        </div>
        {message && (
          <p role="alert" className="relative z-10 mt-2 text-xs leading-5 text-red-600">
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

export default BookCard;
