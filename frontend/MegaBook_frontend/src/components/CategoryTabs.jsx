import { useState } from "react";

const categories = ["پرفروش", "سبک زندگی", "داستان و رمان", "همه"];

export default function CategoryTabs() {
  const [active, setActive] = useState("همه");

  return (
    <div className="category-tabs">
      {categories.map((cat) => (
        <button
          key={cat}
          className={`category-pill ${active === cat ? "active" : ""}`}
          onClick={() => setActive(cat)}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}