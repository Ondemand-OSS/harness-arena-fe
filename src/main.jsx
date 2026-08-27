import './polyfills.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import { AuthProvider } from './auth.jsx'
import './theme.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Analytics />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
