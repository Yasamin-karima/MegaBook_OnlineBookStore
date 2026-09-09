import React from 'react'
import './index.css';
import Navbar from './components/Navbar';
import BottomNavbar from './components/BottomNavbar';
import BookCard from './components/BookCard';
import HomePage from './components/HomePage';
import Footer from './components/Footer';
import Login from './components/Login'

const App = () => {
  return (
    <>
    <Login />
    </>
  )
  // return (
  //   <>
  //     <BottomNavbar />
  //     <Navbar />
  //     <div className="pt-20 pb-20">
  //       <HomePage />
  //       <Footer />
  //     </div>
  //     <html lang="fa" dir="rtl">
  //       <head>
  //         <meta charSet="UTF-8" />
  //         <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  //         <title>Mega Book Marketplace</title>
  //         <script src="https://cdn.tailwindcss.com"></script>
  //         <link href="index.css" rel="stylesheet" />
  //       </head>
  //       {/* <body>

  //         <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">


  //           <section class="hero-gradient rounded-3xl mt-6 p-8 md:p-12 text-white">
  //             <div class="max-w-2xl">
  //               <h2 class="text-3xl md:text-4xl font-bold leading-tight">
  //                 دنیای کتاب‌ها در <br />
  //                 <span class="text-purple-300">دستان شما</span>
  //               </h2>
  //               <p class="mt-4 text-gray-300 text-sm md:text-base">
  //                 بیش از ۱۰٬۰۰۰ کتاب در ژانرهای مختلف با بهترین قیمت‌ها
  //               </p>
  //               <button class="mt-6 bg-white text-gray-900 px-8 py-3 rounded-full font-semibold hover:bg-gray-100 transition shadow-lg">
  //                 شروع جستجو
  //               </button>
  //             </div>
  //           </section>

  //           <section class="mt-12">
  //             <div class="flex items-center justify-between mb-6">
  //               <div>
  //                 <h3 class="section-title text-xl md:text-2xl font-bold text-gray-900">📈 کتاب‌های پرفروش</h3>
  //               </div>
  //               <a href="#" class="text-sm text-purple-600 font-medium hover:underline">مشاهده همه →</a>
  //             </div>

  //             <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">

  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-indigo-100 to-purple-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📘</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">Minimalist Geometry</h4>
  //                 <p class="text-sm text-gray-500">Vance Elena</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$24.99</span>
  //                   <span class="badge-new text-white text-xs px-3 py-1 rounded-full">پرفروش</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>

  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-rose-100 to-orange-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📕</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">High Contrast Design</h4>
  //                 <p class="text-sm text-gray-500">Marcus Aurelius</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$29.50</span>
  //                   <span class="badge-new text-white text-xs px-3 py-1 rounded-full">پرفروش</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>


  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📗</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">The Playful Path</h4>
  //                 <p class="text-sm text-gray-500">Sunny Day</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$18.00</span>
  //                   <span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full">جدید</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>

  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-violet-100 to-fuchsia-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📙</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">Midnight Textures</h4>
  //                 <p class="text-sm text-gray-500">D. S. Dark</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$32.99</span>
  //                   <span class="bg-blue-100 text-blue-700 text-xs px-3 py-1 rounded-full">محدود</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>
  //             </div>
  //           </section>

  //           <section class="mt-16">
  //             <div class="flex items-center justify-between mb-6">
  //               <div>
  //                 <h3 class="section-title text-xl md:text-2xl font-bold text-gray-900">✨ تازه‌ها</h3>
  //               </div>
  //               <a href="#" class="text-sm text-purple-600 font-medium hover:underline">مشاهده همه →</a>
  //             </div>

  //             <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-indigo-100 to-purple-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📘</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">Minimalist Geometry</h4>
  //                 <p class="text-sm text-gray-500">Vance Elena</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$24.99</span>
  //                   <span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full">جدید</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>

  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-rose-100 to-orange-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📕</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">High Contrast Design</h4>
  //                 <p class="text-sm text-gray-500">Marcus Aurelius</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$29.50</span>
  //                   <span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full">جدید</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>

  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📗</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">The Playful Path</h4>
  //                 <p class="text-sm text-gray-500">Sunny Day</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$18.00</span>
  //                   <span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full">جدید</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>

  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-violet-100 to-fuchsia-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📙</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">Midnight Textures</h4>
  //                 <p class="text-sm text-gray-500">D. S. Dark</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$32.99</span>
  //                   <span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full">جدید</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>
  //             </div>
  //           </section>

  //           <section class="mt-6">
  //             <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-sky-100 to-blue-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📖</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">Modern Fiction</h4>
  //                 <p class="text-sm text-gray-500">Jane Doe</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$21.99</span>
  //                   <span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full">جدید</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>

  //               <div class="book-card bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
  //                 <div class="aspect-[3/4] bg-gradient-to-br from-amber-100 to-yellow-100 rounded-xl flex items-center justify-center mb-4">
  //                   <span class="text-6xl">📚</span>
  //                 </div>
  //                 <h4 class="font-bold text-gray-900 text-lg">Abstract Logic</h4>
  //                 <p class="text-sm text-gray-500">Alan Turing</p>
  //                 <div class="flex items-center justify-between mt-3">
  //                   <span class="text-lg font-bold text-gray-900">$27.00</span>
  //                   <span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full">جدید</span>
  //                 </div>
  //                 <button class="w-full mt-3 bg-gray-100 text-gray-800 py-2 rounded-xl text-sm font-medium hover:bg-purple-600 hover:text-white transition">
  //                   افزودن به سبد
  //                 </button>
  //               </div>
  //             </div>
  //           </section>

  //           <section class="mt-16 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-3xl p-8 md:p-12 text-center">
  //             <div class="max-w-2xl mx-auto">
  //               <span class="text-5xl block mb-4">🔍</span>
  //               <h3 class="text-2xl md:text-3xl font-bold text-gray-900">
  //                 کتابی که می‌خواهید را پیدا نمی‌کنید؟
  //               </h3>
  //               <p class="mt-3 text-gray-600 text-sm md:text-base">
  //                 از سیستم درخواست استفاده کنید تا آن کتاب را برایتان تهیه کنیم
  //               </p>
  //               <button class="request-btn text-white px-8 py-3 rounded-full font-semibold mt-6 shadow-lg hover:shadow-xl transition">
  //                 درخواست و ارسال کتاب
  //               </button>
  //             </div>
  //           </section>

  //           <footer class="mt-16 border-t border-gray-200 pt-8 pb-6">
  //             <div class="flex flex-col md:flex-row items-center justify-between gap-4">
  //               <div class="flex items-center gap-2">
  //                 <span class="text-xl font-extrabold text-gray-900">📚 Mega<span class="text-purple-600">Books</span></span>
  //                 <span class="text-sm text-gray-400">v1.4.2</span>
  //               </div>
  //               <div class="flex items-center gap-6 text-sm text-gray-500">
  //                 <span>Secure transactions</span>
  //                 <span class="w-1 h-1 bg-gray-300 rounded-full"></span>
  //                 <span>Community driven</span>
  //               </div>
  //               <div class="flex items-center gap-4">
  //                 <a href="#" class="text-gray-400 hover:text-purple-600 transition">
  //                   <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z" /></svg>
  //                 </a>
  //                 <a href="#" class="text-gray-400 hover:text-purple-600 transition">
  //                   <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z" /></svg>
  //                 </a>
  //                 <a href="#" class="text-gray-400 hover:text-purple-600 transition">
  //                   <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
  //                 </a>
  //               </div>
  //             </div>
  //             <div class="text-center text-xs text-gray-400 mt-6">
  //               © 2026 Mega Book Marketplace. All rights reserved.
  //             </div>
  //           </footer>

  //         </div>

  //       </body> */}
  //     </html>


  //   </>
  // )
}

export default App