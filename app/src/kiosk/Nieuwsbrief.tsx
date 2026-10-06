// Nieuwsbrief-aanmelding (7.9, 11). Vrijwillig: niets is vooraf ingevuld; "Nee, bedankt" gaat gewoon verder.
// De app bewaart het e-mailadres niet; het gaat direct naar het nieuwsbriefsysteem van Fonos.
import { useState } from 'react'
import { X } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Logo } from '../components/Logo'
import { useKiosk } from './KioskApp'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function Nieuwsbrief() {
  const { wisSessie, config } = useKiosk()
  const [email, setEmail] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [klaar, setKlaar] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const verder = () => wisSessie('/home')

  const schrijfIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) { setFout('Dit lijkt geen geldig e-mailadres. Controleer het nog even.'); return }
    setBezig(true)
    setFout(null)
    try {
      await api('/kiosk/nieuwsbrief', { body: { email: email.trim() } })
      setEmail('')
      setKlaar(true)
      setTimeout(verder, 4000)
    } catch (e) { setFout((e as ApiFout).message) } finally { setBezig(false) }
  }

  return (
    <div className="hero">
      <div className="bol bol-a" />
      <div className="bol bol-b" />
      <div className="hero-inhoud" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div className="top"><Logo /><span className="badge-nl">NL</span></div>
      </div>
      <div className="nieuwsbrief">
        {klaar ? (
          <>
            <h1>Bedankt!</h1>
            <p>Je ontvangt zo een e-mail. Bevestig daarin je aanmelding voor de nieuwsbrief.</p>
            <button className="btn btn-pink btn-l" style={{ alignSelf: 'flex-start' }} onClick={verder}>Verder</button>
          </>
        ) : (
          <>
            <h1>Blijf op de hoogte</h1>
            <p>Wil je tips, nieuwe aanwinsten en activiteiten van FONOS ontvangen? Schrijf je in voor onze nieuwsbrief.</p>
            <form className="inschrijf" onSubmit={schrijfIn}>
              <input type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setFout(null) }} placeholder="Je e-mailadres" aria-label="Je e-mailadres" autoComplete="off" />
              <button type="submit" disabled={bezig || !email.trim()}>{bezig ? 'Bezig…' : 'Inschrijven'}</button>
            </form>
            {fout && <div className="fout-tekst" role="alert">{fout}</div>}
            <div className="privacy">{config.instellingen.privacy_tekst} {config.instellingen.privacy_url && <button onClick={() => setPrivacy(true)}>Privacyverklaring</button>}</div>
            <button className="nee-bedankt" onClick={verder}>Nee, bedankt</button>
          </>
        )}
      </div>
      {privacy && (
        <div className="modal-achter">
          <div className="card" style={{ width: 'min(1000px, 100%)', height: '80vh', position: 'relative', overflow: 'hidden' }}>
            <button className="icon-btn" style={{ position: 'absolute', right: 12, top: 12, zIndex: 2 }} onClick={() => setPrivacy(false)} aria-label="Sluiten"><X size={22} /></button>
            <iframe src={config.instellingen.privacy_url} title="Privacyverklaring" style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} sandbox="allow-same-origin" />
          </div>
        </div>
      )}
    </div>
  )
}
