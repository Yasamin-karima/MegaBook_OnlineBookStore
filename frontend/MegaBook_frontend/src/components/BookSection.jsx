import BookCard from "./BookCard";

export default function BookSection({ title, books }) {
  return (
    <section className="book-section">
      <h2 className="section-title">{title}</h2>
      <div className="book-grid">
        {books.map((book) => (
          <BookCard key={book.id} {...book} />
        ))}
      </div>
    </section>
  );
}