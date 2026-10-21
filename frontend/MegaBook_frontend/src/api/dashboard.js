import apiClient from './client';

// Everything the dashboard cards show, in one response (every number computed by the server):
// {
//   user:     { first_name, last_name, email, phone },   // email or phone may be null
//   wallet:   { balance },                                // toman, from the wallet ledger
//   cart:     { count, total },
//   requests: { open, fulfilled, rejected },
//   uploads:  { pending, approved, rejected, sales, earnings }  // earnings: toman, from the ledger
// }
export async function getDashboard() {
  const response = await apiClient.get('/dashboard/');
  return response.data;
}
