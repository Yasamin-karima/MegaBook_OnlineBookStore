import React, { useState } from 'react';
import { 
  LuUser, 
  LuMail, 
  LuLock, 
  LuEye, 
  LuEyeOff,
  LuPhone,
  LuArrowLeft
} from 'react-icons/lu';
// import { Link } from 'react-router-dom';

const SignUp = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Just log the form data - no validation
    const formData = new FormData(e.target);
    console.log('Form submitted:', Object.fromEntries(formData));
    // You can add your own logic here later
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">ثبت‌نام در مگابوک</h1>
          <p className="text-gray-600">همین حالا عضو شوید و از هزاران کتاب لذت ببرید</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              نام و نام خانوادگی
            </label>
            <div className="relative">
              <input
                type="text"
                name="fullName"
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-all duration-200"
                placeholder="نام و نام خانوادگی خود را وارد کنید"
                dir="rtl"
              />
              <LuUser className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ایمیل
            </label>
            <div className="relative">
              <input
                type="email"
                name="email"
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-all duration-200"
                placeholder="example@email.com"
                dir="ltr"
              />
              <LuMail className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              شماره تلفن
            </label>
            <div className="relative">
              <input
                type="tel"
                name="phone"
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-all duration-200"
                placeholder="09123456789"
                dir="ltr"
              />
              <LuPhone className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              رمز عبور
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                className="w-full px-4 py-3 pr-12 pl-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-all duration-200"
                placeholder="رمز عبور خود را وارد کنید"
                dir="ltr"
              />
              <LuLock className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? <LuEyeOff className="w-5 h-5" /> : <LuEye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              تکرار رمز عبور
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                className="w-full px-4 py-3 pr-12 pl-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-all duration-200"
                placeholder="رمز عبور را تکرار کنید"
                dir="ltr"
              />
              <LuLock className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showConfirmPassword ? <LuEyeOff className="w-5 h-5" /> : <LuEye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Terms */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              name="acceptTerms"
              className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label className="text-sm text-gray-600">
              <span>شرایط و قوانین </span>
              <a href="#" className="text-blue-600 hover:underline">مگابوک</a>
              <span> را می‌پذیرم</span>
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
          >
            ثبت‌نام
            <LuArrowLeft className="w-5 h-5" />
          </button>

          {/* Login Link */}
          {/* <p className="text-center text-sm text-gray-600">
            قبلاً عضو شده‌اید؟{' '}
            <Link to="/login" className="text-blue-600 hover:underline font-medium">
              وارد شوید
            </Link>
          </p> */}
        </form>
      </div>
    </div>
  );
};

export default SignUp;