import React from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import './index.css';
import Navbar from './components/Navbar';
import BottomNavbar from './components/BottomNavbar';
import HomePage from './components/HomePage';
import Footer from './components/Footer';
import LoginPage from './components/Login';
import SignupPage from './components/Signup';
import ListUsers from './components/ListUsers';
import AddBookWizard from './components/AddBookWizard';
import ProtectedRoute from './components/ProtectedRoute';

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

// دکمه‌ی بازگشت فرم: به صفحه‌ی قبلی برمی‌گردد. اگر کاربر مستقیم با آدرس آمده باشد
// و صفحه‌ی قبلی در سایت نداشته باشد (idx === 0)، به صفحه‌ی اصلی می‌رود.
const AddBookPage = () => {
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/');
  };
  return <AddBookWizard onBack={goBack} />;
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
      {/* هر آدرس ناشناخته‌ای به صفحه اصلی برمی‌گردد */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
