import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Navbar from './components/Navbar';
import BottomNavbar from './components/BottomNavbar';
import HomePage from './components/HomePage';
import Footer from './components/Footer';
import LoginPage from './components/Login';
import SignupPage from './components/Signup';
import ListUsers from './components/ListUsers';
import AddBookWizard from './components/AddBookWizard';
import RequestByIsbnPage from './components/RequestByIsbnPage';
import BookDetailPage from './components/BookDetailPage';
import ProtectedRoute from './components/ProtectedRoute';
import useGoBack from './hooks/useGoBack';

// صفحه اصلی با نوار بالا/پایین و فوتر
const Home = () => {
  return (
    <>
      <BottomNavbar />
      <Navbar />
      <div className="pt-20 pb-20">
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

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/users" element={<ListUsers />} />
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
      {/* هر آدرس ناشناخته‌ای به صفحه اصلی برمی‌گردد */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
