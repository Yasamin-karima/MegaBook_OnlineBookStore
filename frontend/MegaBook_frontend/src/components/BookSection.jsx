import React from "react";
import BookCard from "./BookCard";
import { LuChevronLeft } from 'react-icons/lu';

export default function BookSection({ title, books }) {
  return (
    <section className="my-8 px-4">
      {/* Section Header */}
      <div className="flex justify-between items-center mb-6 px-2">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        </div>
        <a
          href="#"
          className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition-all duration-200"
        >
          مشاهده همه
          <LuChevronLeft className="w-4 h-4" />
        </a>
      </div>

      {/* Scrollable Books */}
      <div className="flex gap-10 overflow-x-auto pb-4 scroll-smooth">
        {books.map((book) => (
          <div
            key={book.id}
            className="flex-none w-56"
          >
            <BookCard key={book.id} {...book} />
          </div>
        ))}
      </div>
    </section>
  );
}