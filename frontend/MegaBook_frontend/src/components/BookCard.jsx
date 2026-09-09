import React from 'react';
import { LuShoppingCart } from 'react-icons/lu';

const BookCard = ({ title, author, price, rating, image, badge }) => {
  return (
    <div className="w-64 bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-300">
      {/* Book Cover Image */}
      <div className="relative h-80 bg-gray-200">
        <img
          src={image}
          alt="Book cover"
          className="w-full h-full object-cover"
        />
        {/* Rating Badge */}
        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg text-sm font-semibold text-gray-800 shadow-md flex items-center gap-1">
          <span>⭐</span>
          <span>{rating}</span>
        </div>
        <div className="absolute top-3 left-3 bg-blue-600 backdrop-blur-sm px-2 py-1 rounded-lg text-sm font-semibold text-white shadow-md flex items-center gap-1">
          <span>{badge}</span>
        </div>
      </div>

      {/* Book Details */}
      <div className="p-4">
        {/* Title */}
        <h3 className="text-lg font-bold text-gray-900 mb-1 line-clamp-2">
          {title}
        </h3>

        {/* Author */}
        <p className="text-sm text-gray-600 mb-2">
          {author}
        </p>
        
        {/* Price */}
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-gray-900">{price}</span>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors duration-200">
            <LuShoppingCart className='text-2xl' />
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookCard;