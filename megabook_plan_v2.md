# MegaBook — One-Month Day-by-Day Plan (v2: repair & extend)

**Starting point:** homepage with placeholder data + a login page already built, but not yet connected to a real JSON API; Docker Compose running backend + frontend + Postgres.
**Pace:** ~3-4 focused hours/day is the core estimate below; if you get a full 5-6 hour day, treat the extra time as a head start on the next day rather than a bigger single day.

**Legend:**
- 🧠 = learn it yourself — a core skill worth the friction, explain-as-you-go
- 🤖 = let AI generate it, you review and adapt
- 🧠🤖 = AI drafts it, but trace through *why* it works before moving on

---

### Day 1 — Diagnose the login issue
**What & why:** Confirm whether your current login endpoint is a real JSON API (DRF) or Django's built-in HTML login page — this is almost certainly why the frontend can't connect. Test it directly with curl/Postman to see the raw response.
**Type:** 🧠
**Time:** 3 hrs

### Day 2 — Fix the auth endpoint
**What & why:** If it's the wrong kind of view, wire up a proper JSON login endpoint (e.g. `TokenObtainPairView`) and trace the full URL → View → Serializer chain for it, so the pattern is clear for every endpoint after this.
**Type:** 🧠
**Time:** 3-4 hrs

### Day 3 — Connect React login to the real endpoint
**What & why:** Point your existing login page at the fixed endpoint with axios: send credentials, receive tokens, store them, redirect on success.
**Type:** 🧠🤖
**Time:** 3 hrs

### Day 4 — Protected routes & token attachment
**What & why:** Build a route wrapper that redirects to login when there's no token, and an axios interceptor that attaches the token to every future request. Test that a page refresh keeps you logged in.
**Type:** 🧠🤖
**Time:** 3-4 hrs

### Day 5 — Buffer / catch-up
**What & why:** Absorb any overflow from Days 1-4. If ahead, read up on DRF's `ModelSerializer` and `ModelViewSet` for tomorrow.
**Type:** —
**Time:** flexible

### Day 6 — Book model
**What & why:** Design and migrate the `Book` model (title, author, ISBN, price, uploaded_by). Understand migrations properly, since this same pattern repeats for every model going forward.
**Type:** 🧠
**Time:** 3 hrs

### Day 7 — Catalog API
**What & why:** Build the list/detail API for books using `ModelViewSet`. Let AI scaffold the serializer/viewset/router boilerplate; you review and adjust the fields.
**Type:** 🤖
**Time:** 2-3 hrs

### Day 8 — Real data on the homepage
**What & why:** Replace your homepage's placeholder arrays with real axios calls to the Catalog API — same components, real data. This is the moment the frontend and backend actually meet.
**Type:** 🧠🤖
**Time:** 3 hrs

### Day 9 — ISBN metadata integration
**What & why:** Pick a metadata API (Open Library or Google Books) and build a backend endpoint that takes an ISBN and returns title/author/cover metadata. New integration pattern, worth understanding directly.
**Type:** 🧠
**Time:** 3-4 hrs

### Day 10 — Admin book-creation endpoint
**What & why:** Wire the ISBN lookup into an admin-only "create book" endpoint. AI can draft the request-handling glue once you've decided the shape of the data.
**Type:** 🤖
**Time:** 2-3 hrs

### Day 11 — "Add book via ISBN" form
**What & why:** Build the admin-facing React form that calls the Day 9/10 endpoints. The form UI itself is AI-draftable; trace how the returned metadata flows into the UI yourself.
**Type:** 🧠🤖
**Time:** 3 hrs

### Day 12 — Buffer + book detail page
**What & why:** Catch up if needed, and build the book detail page in React if it isn't done yet.
**Type:** 🤖
**Time:** 2-3 hrs

### Day 13 — Wallet as a transaction ledger
**What & why:** Implement the wallet as an immutable ledger of transactions (not a mutable balance field), plus a recharge endpoint. This is a real design decision worth understanding, not just pasting.
**Type:** 🧠
**Time:** 3-4 hrs

### Day 14 — Wallet page
**What & why:** Build the React wallet page: balance display (derived from the ledger) and a recharge form.
**Type:** 🤖
**Time:** 2 hrs

### Day 15 — Cart state
**What & why:** Add cart state in React (Context or simple state) with add/remove/view — no backend involvement yet.
**Type:** 🤖
**Time:** 2-3 hrs

### Day 16 — Checkout endpoint
**What & why:** Build the endpoint that debits the wallet, creates an Order, and grants the book to the buyer's library. This touches the ledger and order logic together — worth stepping through carefully.
**Type:** 🧠
**Time:** 3-4 hrs

### Day 17 — Checkout flow & purchased library
**What & why:** Build the React checkout flow (cart → confirm → success) and the "My Library → Purchased" page.
**Type:** 🧠🤖
**Time:** 3 hrs

### Day 18 — Buffer / end-to-end testing
**What & why:** Click through browse → cart → wallet → purchase as a real user would, and fix whatever breaks.
**Type:** 🧠
**Time:** 3 hrs

### Day 19 — Open uploads to regular users
**What & why:** Extend the book-creation endpoint so any authenticated user can upload (not just admin), setting `uploaded_by` and their own price. Mostly reuses Day 10/11's pattern.
**Type:** 🤖
**Time:** 2 hrs

### Day 20 — "My Uploads" + edge cases
**What & why:** Build the "My Library → My Uploads" page, and handle duplicate/invalid ISBN edge cases.
**Type:** 🧠🤖
**Time:** 3 hrs

### Day 21 — Request model & creation
**What & why:** Build the `Request` model (status: open/fulfilled), its creation endpoint, and the React "request a book" form.
**Type:** 🧠🤖
**Time:** 3 hrs

### Day 22 — Public request board
**What & why:** Build the list of all open requests, visible to every user. Structurally similar to the Catalog list, so AI can draft it quickly.
**Type:** 🤖
**Time:** 2 hrs

### Day 23 — Fulfillment linking
**What & why:** Implement the logic that links an uploaded book back to a request and marks it fulfilled. A real domain decision point — understand it rather than pasting it in.
**Type:** 🧠
**Time:** 3-4 hrs

### Day 24 — Tickets (chat on a request)
**What & why:** Build the `Ticket` message model attached to a Request, its endpoints, and a simple polling-based chat UI (no websockets needed).
**Type:** 🧠🤖
**Time:** 3-4 hrs

### Day 25 — Buffer / testing
**What & why:** Walk through the requests + tickets flow end to end and fix issues.
**Type:** 🧠
**Time:** 3 hrs

### Day 26 — Admin dashboard
**What & why:** Build the requests queue with a "mark fulfilled" action and the read-only users list. Scope is deliberately narrow, so AI can draft these pages fast.
**Type:** 🤖
**Time:** 3 hrs

### Day 27 — Bug bash & polish
**What & why:** Walk through the entire app end to end, fix what breaks, and clean up loading/error states.
**Type:** 🧠
**Time:** 3-4 hrs

### Day 28 — Deployment prep
**What & why:** Finalize the production Docker Compose config and write a short README for handoff. Go flag-by-flag on any Docker command you're unsure of.
**Type:** 🧠
**Time:** 3-4 hrs

---

## Notes
- 28 working days ≈ under 5 weeks at 6 days/week — leaves real slack inside your one-month window.
- Days 5, 12, 18, 25 are intentionally light buffer days — if you're behind, that's where it gets absorbed.
- 🧠 days are where understanding matters most for your own learning goals and for your team's ability to maintain this later — don't rush past these even if AI could shortcut them.
