export default function RequestBanner() {
  return (
    <div className="request-banner">
      <div className="request-banner-header">
        <span className="request-icon">🏷️</span>
        <h3>کتابی که میخواهید را پیدا نمی‌کنید؟</h3>
      </div>

      <p className="request-banner-text">
        از میان درخواست‌های ثبت شده جستجو کنید یا برای دریافت کتاب مورد نظر
        خود درخواست جدید ثبت کنید.
      </p>

      <button className="request-banner-btn">
        📖 درخواست بر اساس شابک
      </button>
    </div>
  );
}