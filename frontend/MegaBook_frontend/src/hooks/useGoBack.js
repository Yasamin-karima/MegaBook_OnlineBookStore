import { useNavigate } from "react-router-dom";

// دکمه‌ی «برگشت» صفحه‌های داخلی: به صفحه‌ی قبلی برمی‌گردد. اگر کاربر مستقیم با آدرس آمده باشد
// و صفحه‌ی قبلی در سایت نداشته باشد (idx === 0)، به‌جای بیرون رفتن از سایت به صفحه‌ی اصلی می‌رود.
// idx را BrowserRouter خودش در history.state نگه می‌دارد.
export default function useGoBack() {
  const navigate = useNavigate();
  return () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate("/");
  };
}
