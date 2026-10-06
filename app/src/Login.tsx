// Inloggen voor medewerkers, redacteuren en beheerders; wachtwoord (her)instellen via e-maillink.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiFout } from './api'
import { Logo } from './components/Logo'
import { Laden } from './components/Iconen'

export type Ik = { id: number; email: string; naam: string; rollen: string[] }

export function useIk() {
  const [ik, setIk] = useState<Ik | null | undefined>(undefined)
  const laad = useCallback(() => api<Ik>('/auth/ik').then(setIk).catch(() => setIk(null)), [])
  useEffect(() => { laad() }, [laad])
  const uit = async () => { await api('/auth/logout', { method: 'POST' }); setIk(null) }
  return { ik, setIk, uit }
}

export const initialen = (naam: string) => naam.split(/\s+/).filter(Boolean).map((w) => w[0]).filter((c) => c === c.toUpperCase()).slice(0, 2).join('') || naam.slice(0, 2).toUpperCase()
export const heeftRol = (ik: Ik, ...r: string[]) => r.some((x) => ik.rollen.includes(x) || (x === 'redacteur' && ik.rollen.includes('beheerder')))

export function Login({ titel, onIn }: { titel: string; onIn: (ik: Ik) => void }) {
  const [email, setEmail] = useState('')
  const [ww, setWw] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [vergeten, setVergeten] = useState(false)
  const [verstuurd, setVerstuurd] = useState(false)
  const in_ = async (e: React.FormEvent) => {
    e.preventDefault()
    setFout(null)
    try {
      if (vergeten) { await api('/auth/reset-aanvraag', { body: { email } }); setVerstuurd(true); return }
      onIn(await api<Ik>('/auth/login', { body: { email, wachtwoord: ww } }))
    } catch (e) { setFout((e as ApiFout).message) }
  }
  return (
    <div className="login-scherm">
      <div className="bol bol-a" style={{ opacity: .6 }} />
      <div className="bol bol-b" style={{ opacity: .6 }} />
      <form className="card login" onSubmit={in_}>
        <Logo />
        <h1>{titel}</h1>
        <p>{vergeten ? 'Vul je e-mailadres in. Je krijgt een link om een nieuw wachtwoord te kiezen.' : 'Log in met je persoonlijke account.'}</p>
        {verstuurd ? <div className="melding-blok ok">Als dit adres bij ons bekend is, is er een e-mail met een link verstuurd.</div> : (
          <>
            <label className="veld"><span>E-mailadres</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
            {!vergeten && <label className="veld"><span>Wachtwoord</span><input type="password" value={ww} onChange={(e) => setWw(e.target.value)} autoComplete="current-password" required /></label>}
            {fout && <div className="melding-blok fout">{fout}</div>}
            <button className="btn btn-pink btn-block" type="submit">{vergeten ? 'Stuur link' : 'Inloggen'}</button>
          </>
        )}
        <button type="button" className="link-terug" style={{ marginTop: 8 }} onClick={() => { setVergeten(!vergeten); setVerstuurd(false); setFout(null) }}>
          {vergeten ? 'Terug naar inloggen' : 'Wachtwoord vergeten?'}
        </button>
      </form>
    </div>
  )
}

export function Wachtwoord() {
  const [p] = useSearchParams()
  const [ww, setWw] = useState('')
  const [ww2, setWw2] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const nav = useNavigate()
  const zet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (ww !== ww2) { setFout('De wachtwoorden zijn niet gelijk.'); return }
    try { await api('/auth/reset', { body: { token: p.get('token'), wachtwoord: ww } }); setOk(true) } catch (e) { setFout((e as ApiFout).message) }
  }
  return (
    <div className="login-scherm">
      <form className="card login" onSubmit={zet}>
        <Logo />
        <h1>Wachtwoord kiezen</h1>
        {ok ? (
          <>
            <div className="melding-blok ok">Je wachtwoord is ingesteld.</div>
            <button type="button" className="btn btn-pink btn-block" onClick={() => nav('/beheer')}>Naar de beheeromgeving</button>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => nav('/medewerker')}>Naar het medewerkersscherm</button>
          </>
        ) : (
          <>
            <p>Minstens 10 tekens.</p>
            <label className="veld"><span>Nieuw wachtwoord</span><input type="password" value={ww} onChange={(e) => setWw(e.target.value)} autoComplete="new-password" minLength={10} required /></label>
            <label className="veld"><span>Nog een keer</span><input type="password" value={ww2} onChange={(e) => setWw2(e.target.value)} autoComplete="new-password" required /></label>
            {fout && <div className="melding-blok fout">{fout}</div>}
            <button className="btn btn-pink btn-block" type="submit">Opslaan</button>
          </>
        )}
      </form>
    </div>
  )
}

export function Afgeschermd({ titel, rollen, children }: { titel: string; rollen: string[]; children: (ik: Ik, uit: () => void) => React.ReactNode }) {
  const { ik, setIk, uit } = useIk()
  if (ik === undefined) return <div className="login-scherm"><Laden /></div>
  if (!ik) return <Login titel={titel} onIn={setIk} />
  if (!heeftRol(ik, ...rollen)) return (
    <div className="login-scherm"><div className="card login"><Logo /><h1>Geen toegang</h1><p>Je account heeft niet de juiste rol voor dit scherm.</p><button className="btn btn-ghost" onClick={uit}>Uitloggen</button></div></div>
  )
  return <>{children(ik, uit)}</>
}
