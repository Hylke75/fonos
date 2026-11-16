import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './styles.css'
import { KioskApp } from './kiosk/KioskApp'
import { StaffApp } from './staff/StaffApp'
import { AdminApp } from './admin/AdminApp'
import { Wachtwoord } from './Login'
import { startFoutmelder } from './foutmelder'

startFoutmelder()

/** Vangnet: een fout tijdens het tekenen geeft geen leeg scherm, maar een knop om opnieuw te beginnen (en een melding aan de server). */
class Vangnet extends Component<{ children: ReactNode }, { fout: boolean }> {
  state = { fout: false }
  static getDerivedStateFromError() { return { fout: true } }
  componentDidCatch(e: Error) { window.dispatchEvent(new ErrorEvent('error', { message: e.message, error: e })) }
  render() {
    if (!this.state.fout) return this.props.children
    return (
      <div className="login-scherm">
        <div className="card login">
          <h1>Er ging iets mis</h1>
          <p>Something went wrong.</p>
          <button className="btn btn-pink btn-block" onClick={() => location.reload()}>Opnieuw beginnen</button>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Vangnet>
      <BrowserRouter>
        <Routes>
          <Route path="/medewerker/*" element={<StaffApp />} />
          <Route path="/beheer/*" element={<AdminApp />} />
          <Route path="/wachtwoord" element={<Wachtwoord />} />
          <Route path="/*" element={<KioskApp />} />
        </Routes>
      </BrowserRouter>
    </Vangnet>
  </StrictMode>,
)
