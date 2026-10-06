import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './styles.css'
import { KioskApp } from './kiosk/KioskApp'
import { StaffApp } from './staff/StaffApp'
import { AdminApp } from './admin/AdminApp'
import { Wachtwoord } from './Login'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/medewerker/*" element={<StaffApp />} />
        <Route path="/beheer/*" element={<AdminApp />} />
        <Route path="/wachtwoord" element={<Wachtwoord />} />
        <Route path="/*" element={<KioskApp />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
