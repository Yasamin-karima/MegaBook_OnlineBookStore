import React from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import './index.css';
import Navbar from './components/Navbar';
import BottomNavbar from './components/BottomNavbar';
import DesktopNav from './components/DesktopNav';
import HomePage from './components/HomePage';
import Footer from './components/Footer';
import LoginPage from './components/Login';
import SignupPage from './components/Signup';
import AddBookWizard from './components/AddBookWizard';
import RequestByIsbnPage from './components/RequestByIsbnPage';
import BookDetailPage from './components/BookDetailPage';
import AccountPage from './components/AccountPage';
import WalletPage from './components/WalletPage';
import CartPage from './components/CartPage';
import LibraryPage from './components/LibraryPage';
import BookReaderPage from './components/BookReaderPage';
import DashboardPage from './components/DashboardPage';
import ChangePasswordPage from './components/ChangePasswordPage';
import PublicRequestsPage from './components/PublicRequestsPage';
import ConversationPage from './components/ConversationPage';
import MyRequestsUploadsPage from './components/MyRequestsUploadsPage';
import NotificationsPage from './components/NotificationsPage';
import ProtectedRoute from './components/ProtectedRoute';
import useGoBack from './hooks/useGoBack';

// Every page except login/sign-up and the reader: on desktop (md+) a side nav on the right,
// and the page is pushed left by its width (ps = padding on the start side, the right in RTL).
// Below md this adds nothing: DesktopNav is hidden and the padding is 0.
const AppLayout = () => {
  return (
    <>
      <DesktopNav />
      <div className="md:ps-20 lg:ps-60">
        <Outlet />
      </div>
    </>
  )
}

// صفحه اصلی با نوار بالا/پایین و فوتر
// On desktop both bars are hidden (DesktopNav replaces them), so their padding goes too.
const Home = () => {
  return (
    <>
      <BottomNavbar />
      <Navbar />
      <div className="pt-20 pb-20 md:pt-0 md:pb-0">
        <HomePage />
        <Footer />
      </div>
    </>
  )
}

// useGoBack (src/hooks) دکمه‌ی بازگشت صفحه‌های داخلی را می‌سازد
const AddBookPage = () => {
  const goBack = useGoBack();
  return <AddBookWizard onBack={goBack} />;
}

const RequestByIsbnRoute = () => {
  const goBack = useGoBack();
  return <RequestByIsbnPage onBack={goBack} />;
}

const AccountRoute = () => {
  const goBack = useGoBack();
  return <AccountPage onBack={goBack} />;
}

const WalletRoute = () => {
  const goBack = useGoBack();
  return <WalletPage onBack={goBack} />;
}

const CartRoute = () => {
  const goBack = useGoBack();
  return <CartPage onBack={goBack} />;
}

const BookReaderRoute = () => {
  const goBack = useGoBack();
  return <BookReaderPage onBack={goBack} />;
}

const ChangePasswordRoute = () => {
  const goBack = useGoBack();
  return <ChangePasswordPage onBack={goBack} />;
}

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      {/* خواندن کتابی که کاربر دارد؛ برای بقیه پیام «این کتاب را ندارید» */}
      <Route
        path="/library/:id/read"
        element={
          <ProtectedRoute>
            <BookReaderRoute />
          </ProtectedRoute>
        }
      />
      {/* Pages with the desktop side nav (AppLayout); the routes themselves are unchanged */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        {/* فقط برای کاربر واردشده؛ بقیه به /login فرستاده می‌شوند */}
        <Route
          path="/books/new"
          element={
            <ProtectedRoute>
              <AddBookPage />
            </ProtectedRoute>
          }
        />
        {/* صفحه‌ی یک کتاب؛ عمومی. React Router مسیر ثابت /books/new را بر :id مقدم می‌داند،
            پس این دو با هم قاطی نمی‌شوند. */}
        <Route path="/books/:id" element={<BookDetailPage />} />
        {/* جستجوی شابک فقط برای کاربر واردشده است، پس صفحه هم محافظت‌شده است */}
        <Route
          path="/requests/new"
          element={
            <ProtectedRoute>
              <RequestByIsbnRoute />
            </ProtectedRoute>
          }
        />
        {/* The user's own account: names, email, phone, logout */}
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountRoute />
            </ProtectedRoute>
          }
        />
        {/* The cart lives on the server, per user */}
        <Route
          path="/cart"
          element={
            <ProtectedRoute>
              <CartRoute />
            </ProtectedRoute>
          }
        />
        {/* The user's wallet: balance, history, top-up, withdrawal */}
        <Route
          path="/wallet"
          element={
            <ProtectedRoute>
              <WalletRoute />
            </ProtectedRoute>
          }
        />
        {/* کتابخانه: کتاب‌های خریداری‌شده و بارگذاری‌شده‌ی کاربر */}
        <Route
          path="/library"
          element={
            <ProtectedRoute>
              <LibraryPage />
            </ProtectedRoute>
          }
        />
        {/* مبادله‌ی کتاب: لیست عمومی درخواست‌های باز؛ بدون ورود هم دیده می‌شود */}
        <Route path="/requests" element={<PublicRequestsPage />} />
        {/* جزئیات یک درخواست من (RequestEntry) و یک بارگذاری من، با گفتگوی پشتیبانی.
            React Router مسیر ثابت /requests/new را بر :id مقدم می‌داند. */}
        <Route
          path="/requests/:id"
          element={
            <ProtectedRoute>
              <ConversationPage kind="request" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/uploads/:id"
          element={
            <ProtectedRoute>
              <ConversationPage kind="upload" />
            </ProtectedRoute>
          }
        />
        {/* داشبورد: خلاصه‌ی حساب، کیف پول، سبد، درخواست‌ها و بارگذاری‌ها */}
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <NotificationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        {/* «درخواست‌ها و آپلودهای من»: زیرصفحه‌ی داشبورد، برای پیگیری (?tab=requests|uploads&status=…) */}
        <Route
          path="/dashboard/my-items"
          element={
            <ProtectedRoute>
              <MyRequestsUploadsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/password"
          element={
            <ProtectedRoute>
              <ChangePasswordRoute />
            </ProtectedRoute>
          }
        />
      </Route>
      {/* هر آدرس ناشناخته‌ای به صفحه اصلی برمی‌گردد */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
