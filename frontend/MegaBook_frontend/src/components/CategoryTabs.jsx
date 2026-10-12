import React from 'react';

// تب‌ها از بیرون (HomePage) می‌آیند و انتخاب تب هم به بیرون خبر داده می‌شود.
// خود این کامپوننت state ندارد؛ HomePage باید بداند کدام تب فعال است تا کتاب‌های همان را بگیرد.
//   categories: [{ id, name }] از API (تب «همه» را خود این کامپوننت اول اضافه می‌کند)
//   activeId:   شناسه‌ی تب فعال، null یعنی «همه»
//   status:     'loading' | 'error' | 'success' برای درخواست دسته‌بندی‌ها
const ALL = { id: null, name: 'همه' };

const CategoryTabs = ({ categories, activeId, onSelect, status, onRetry }) => {
  const tabs = [ALL, ...categories];

  return (
    <div className="w-full bg-white border-b border-gray-200">
      <div className="flex overflow-x-auto gap-2 px-4 py-3 items-center">
        {tabs.map((category) => (
          <button
            key={category.id ?? 'all'}
            onClick={() => onSelect(category.id)}
            className={`
              whitespace-nowrap px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 shrink-0
              ${
                activeId === category.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
            `}
          >
            {category.name}
          </button>
        ))}

        {/* تب «همه» همیشه هست؛ بقیه‌ی تب‌ها تا آمدن جواب API این پیام‌ها را نشان می‌دهند */}
        {status === 'loading' && (
          <span className="whitespace-nowrap px-2 text-sm text-gray-500">در حال بارگذاری دسته‌بندی‌ها…</span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-2 whitespace-nowrap px-2 text-sm text-red-600">
            دریافت دسته‌بندی‌ها انجام نشد.
            <button onClick={onRetry} className="font-semibold text-blue-600 hover:underline">
              تلاش دوباره
            </button>
          </span>
        )}
      </div>
    </div>
  );
};

export default CategoryTabs;
