import apiClient from './client';

// The library page's data. Lists are paginated DRF-style: { count, next, previous, results }.

// Books I bought, newest purchase first:
// [{ id (the book's id), title, authors: [names], cover, purchased_at }]
export async function getLibrary(page = 1) {
  const response = await apiClient.get('/library/', { params: { page } });
  return response.data;
}

// Books I uploaded, in every status:
// [{ id, title, authors: [names], cover, price, status: "pending" | "approved" | "rejected", created_at }]
export async function getMyUploads(page = 1) {
  const response = await apiClient.get('/library/uploads/', { params: { page } });
  return response.data;
}

// Tab counters => { purchased, uploaded, bookmarked: null } (no bookmarks backend yet)
export async function getLibrarySummary() {
  const response = await apiClient.get('/library/summary/');
  return response.data;
}
