import React from 'react';
import { LuBookOpen, LuMail, LuPhone, LuMapPin } from 'react-icons/lu';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-900 text-gray-300 mt-12">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <LuBookOpen className="w-6 h-6 text-blue-400" />
              <span className="text-xl font-bold text-white">مگابوک</span>
            </div>
            <p className="text-sm text-gray-400">
              بزرگترین مارکت‌پلیس کتاب فارسی و انگلیسی
            </p>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-white font-semibold mb-2">تماس با ما</h4>
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2">
                <LuPhone className="w-4 h-4 text-blue-400" />
                ۰۲۱-۱۲۳۴-۵۶۷۸
              </p>
              <p className="flex items-center gap-2">
                <LuMail className="w-4 h-4 text-blue-400" />
                support@megabook.ir
              </p>
              <p className="flex items-center gap-2">
                <LuMapPin className="w-4 h-4 text-blue-400" />
                تهران، خیابان انقلاب
              </p>
            </div>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-white font-semibold mb-2">دسترسی سریع</h4>
            <div className="flex flex-wrap gap-2 text-sm">
              <a href="#" className="hover:text-blue-400 transition-colors">کتاب‌های پرفروش</a>
              <span className="text-gray-600">|</span>
              <a href="#" className="hover:text-blue-400 transition-colors">تازه‌های نشر</a>
              <span className="text-gray-600">|</span>
              <a href="#" className="hover:text-blue-400 transition-colors">درباره ما</a>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-6 pt-4 border-t border-gray-800 text-center text-sm text-gray-500">
          © {currentYear} مگابوک. تمامی حقوق محفوظ است.
        </div>
      </div>
    </footer>
  );
};

export default Footer;