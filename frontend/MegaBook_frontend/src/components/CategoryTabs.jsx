import React, { useState } from 'react';

const CategoryTabs = () => {
  const [activeCategory, setActiveCategory] = useState('پرفروش');

  const categories = [
    'پرفروش',
    'سبک زندگی',
    'داستان و رمان',
    'همه',
    'رمانتیک',
    'تاریخی',
    'علمی تخیلی',
    'کودک و نوجوان',
    'شعر',
    'خاطرات',
  ];

  return (
    <div className="w-full bg-white border-b border-gray-200">
      <div className="flex overflow-x-auto gap-2 px-4 py-3">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`
              whitespace-nowrap px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 shrink-0
              ${
                activeCategory === category
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
            `}
          >
            {category}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CategoryTabs;