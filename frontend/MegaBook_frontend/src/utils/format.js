// قالب‌بندی‌های مشترک صفحه‌ها (صفحه‌ی اصلی، فرم بارگذاری کتاب، صفحه‌ی کتاب).
// هر جا عدد، قیمت، سال، حجم فایل یا نام زبان نمایش داده می‌شود، از همین‌جا بیاید
// تا همه‌ی صفحه‌ها یک شکل باشند و تغییر فقط یک جا انجام شود.

// مقدار code همان چیزی است که در فیلد language مدل Book ذخیره می‌شود
export const LANGUAGES = [
  { code: "en", name: "انگلیسی" },
  { code: "fa", name: "فارسی" },
  { code: "ar", name: "عربی" },
  { code: "fr", name: "فرانسوی" },
  { code: "de", name: "آلمانی" },
];

// "fa" -> «فارسی»؛ کد ناشناخته همان‌طور برمی‌گردد
export function languageName(code) {
  return LANGUAGES.find((lang) => lang.code === code)?.name ?? code;
}

// ۱۸۵۰۰۰ -> «۱۸۵٬۰۰۰» (رقم فارسی و جداکننده‌ی هزارگان)
export function toFaNumber(n) {
  return Number(n).toLocaleString("fa-IR");
}

// سال بدون جداکننده‌ی هزارگان: «۱۴۰۰» نه «۱٬۴۰۰»
export function toFaYear(n) {
  return Number(n).toLocaleString("fa-IR", { useGrouping: false });
}

// میانگین امتیاز با یک رقم اعشار: 4.5 -> «۴٫۵»، 4 -> «۴٫۰»
export function formatRating(average) {
  return Number(average).toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// تاریخ شمسی از رشته‌ی ISO سرور: «۲ آبان ۱۴۰۵». fa-IR خودش تقویم شمسی است.
export function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
}

// قیمت به تومان (عدد صحیح)؛ صفر یعنی رایگان
export function formatPrice(price) {
  if (price === 0) return "رایگان";
  return `${toFaNumber(price)} تومان`;
}

// حجم فایل به بایت -> «۴٫۲ مگابایت» یا «۳۵۰ کیلوبایت»؛ برای مقدار خالی null
export function formatFileSize(bytes) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("fa-IR")} کیلوبایت`;
}
