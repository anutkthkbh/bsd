import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import NotificationHost from './NotificationHost'
import './style.css'
import './notifications.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <NotificationHost />
    </BrowserRouter>
  </React.StrictMode>,
)
