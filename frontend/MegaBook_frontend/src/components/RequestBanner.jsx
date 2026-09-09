import React from 'react';
import { LuBookOpen, LuArrowLeft } from 'react-icons/lu';

const RequestBanner = () => {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl mx-4 my-8 p-6 md:p-8 shadow-lg">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <LuBookOpen className="text-white w-5 h-5" />
            <h3 className="text-lg md:text-xl font-bold text-white">
              کتابی که میخواهید را پیدا نمی‌کنید؟
            </h3>
          </div>
          <p className="text-blue-100 text-sm md:text-base">
            از سیستم درخواست بر اساس شابک ما استفاده کنید تا آن کتاب را برایتان تهیه کنیم.
          </p>
        </div>
        
        <button className="flex items-center gap-2 bg-white text-blue-700 hover:bg-blue-50 px-5 py-2.5 rounded-xl font-medium transition-all duration-200 shadow-md hover:shadow-lg whitespace-nowrap">
          درخواست بر اساس شابک
          <LuArrowLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default RequestBanner;