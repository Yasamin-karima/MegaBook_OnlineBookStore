export default function BookCard({ title, author, price, rating, image, badge }) {
  return (
    <div className="book-card">
      <div className="book-cover-wrapper">
        {/* Cover image - swap src with real path later */}
        <img src={image} alt={title} className="book-cover" />

        {/* Optional badge: پرفروش / جدید */}
        {badge && <span className="book-badge">{badge}</span>}

        {/* Rating shown on top-left of cover */}
        <span className="book-rating">★ {rating}</span>
      </div>

      <div className="book-info">
        <h3 className="book-title">{title}</h3>
        <p className="book-author">{author}</p>

        <div className="book-footer">
          <span className="book-price">${price}</span>
          <button className="book-cart-btn" aria-label="افزودن به سبد خرید">
            🛒
          </button>
        </div>
      </div>
    </div>
  );
}