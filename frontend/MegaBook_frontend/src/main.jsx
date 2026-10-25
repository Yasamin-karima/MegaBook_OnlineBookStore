import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import CartProvider from './context/CartProvider.jsx'
import NotificationsProvider from './context/NotificationsProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      {/* One cart for the whole app: every component reads it with useCart() */}
      <CartProvider>
        {/* The unread notification count for the bells (polls; inside the router for route changes) */}
        <NotificationsProvider>
          <App />
        </NotificationsProvider>
      </CartProvider>
    </BrowserRouter>
  </StrictMode>,
)
