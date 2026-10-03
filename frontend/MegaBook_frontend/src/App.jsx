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

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/users" element={<ListUsers />} />
      {/* هر آدرس ناشناخته‌ای به صفحه اصلی برمی‌گردد */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
