// Inloggen voor medewerkers, redacteuren en beheerders; wachtwoord (her)instellen via e-maillink.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiFout } from './api'
import { Logo } from './components/Logo'
import { Laden } from './components/Iconen'

export type Ik = { id: number; email: string; naam: string; rollen: string[]; inactief?: { beheer_min: number; medewerker_min: number } }
type Vergrendeld = { naam: string; email: string; met: 'code' | 'wachtwoord' }

export function useIk() {
  const [ik, setIk] = useState<Ik | null | undefined>(undefined)
  const [vergrendeld, setVergrendeld] = useState<Vergrendeld | null>(null)
  const laad = useCallback(() => api<Ik>('/auth/ik').then((g) => { setIk(g); setVergrendeld(null) }).catch((e: ApiFout) => { setVergrendeld(e.data?.vergrendeld ?? null); setIk(null) }), [])
  useEffect(() => { laad() }, [laad])
  const uit = async () => { await api('/auth/logout', { method: 'POST' }); setIk(null); setVergrendeld(null) }
  const vergrendel = async () => { await api('/auth/vergrendel', { method: 'POST' }).catch(() => {}); await laad() }
  return { ik, setIk: (g: Ik | null) => { setIk(g); if (g) { setVergrendeld(null); laad() } }, uit, vergrendeld, vergrendel }
}

/** Na N minuten zonder aanraken of toetsen: cb (IT-beleid 8.5, clear screen). */
function useInactief(minuten: number, cb: () => void) {
  useEffect(() => {
    if (!minuten) return
    let laatst = Date.now()
    const tik = () => { laatst = Date.now() }
    const ev = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    ev.forEach((e) => window.addEventListener(e, tik, { passive: true, capture: true }))
    const i = setInterval(() => { if (Date.now() - laatst > minuten * 60_000) { laatst = Date.now(); cb() } }, 15_000)
    return () => { ev.forEach((e) => window.removeEventListener(e, tik, { capture: true } as any)); clearInterval(i) }
  }, [minuten]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Vergrendeld scherm: opnieuw de code (of het wachtwoord) om verder te gaan. */
function Ontgrendelen({ titel, v, onIn, uit }: { titel: string; v: Vergrendeld; onIn: (ik: Ik) => void; uit: () => void }) {
  const [invoer, setInvoer] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const verder = async (e: React.FormEvent) => {
    e.preventDefault(); setFout(null)
    try { onIn(await api<Ik>('/auth/ontgrendel', { body: v.met === 'code' ? { code: invoer } : { wachtwoord: invoer } })) } catch (er) {
      const f = er as ApiFout
      if (f.status === 401) uit(); else setFout(f.message)
      setInvoer('')
    }
  }
  return (
    <div className="login-scherm">
      <form className="card login" onSubmit={verder}>
        <Logo />
        <h1>{titel} vergrendeld</h1>
        <p>Het scherm is vergrendeld omdat het een tijd niet gebruikt is. {v.naam}, vul {v.met === 'code' ? 'de code uit je authenticator-app' : 'je wachtwoord'} in om verder te gaan.</p>
        {v.met === 'code'
          ? <label className="veld"><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={invoer} onChange={(e) => setInvoer(e.target.value)} autoFocus required /></label>
          : <label className="veld"><span>Wachtwoord</span><input type="password" autoComplete="current-password" value={invoer} onChange={(e) => setInvoer(e.target.value)} autoFocus required /></label>}
        {fout && <div className="melding-blok fout">{fout}</div>}
        <button className="btn btn-pink btn-block" type="submit">Ontgrendelen</button>
        <button type="button" className="link-terug" style={{ marginTop: 8 }} onClick={uit}>Iemand anders? Uitloggen</button>
      </form>
    </div>
  )
}

export const initialen = (naam: string) => naam.split(/\s+/).filter(Boolean).map((w) => w[0]).filter((c) => c === c.toUpperCase()).slice(0, 2).join('') || naam.slice(0, 2).toUpperCase()
export const heeftRol = (ik: Ik, ...r: string[]) => r.some((x) => ik.rollen.includes(x) || (x === 'redacteur' && ik.rollen.includes('beheerder')))

type Methoden = { google: boolean; wachtwoord: boolean; domein: string | null }
type Stap = { stap: 'code' } | { stap: 'koppelen'; geheim: string; otpauth: string }

export function Login({ titel, onIn }: { titel: string; onIn: (ik: Ik) => void }) {
  const [email, setEmail] = useState('')
  const [ww, setWw] = useState('')
  const [code, setCode] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [vergeten, setVergeten] = useState(false)
  const [verstuurd, setVerstuurd] = useState(false)
  const [methoden, setMethoden] = useState<Methoden | null>(null)
  const [stap, setStap] = useState<Stap | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [p, setP] = useSearchParams()
  useEffect(() => { api<Methoden>('/auth/methoden').then(setMethoden).catch(() => setMethoden({ google: false, wachtwoord: true, domein: null })) }, [])
  // Terug van Google met een foutmelding.
  useEffect(() => {
    const f = p.get('login_fout')
    if (f) { setFout(f); p.delete('login_fout'); setP(p, { replace: true }) }
  }, [])
  useEffect(() => {
    if (stap?.stap !== 'koppelen') { setQr(null); return }
    import('qrcode').then((m) => m.default.toString(stap.otpauth, { type: 'svg', margin: 1, width: 200 })).then(setQr).catch(() => setQr(null))
  }, [stap])
  const in_ = async (e: React.FormEvent) => {
    e.preventDefault()
    setFout(null); setBezig(true)
    try {
      if (vergeten) { await api('/auth/reset-aanvraag', { body: { email } }); setVerstuurd(true); return }
      if (stap) { onIn(await api<Ik>('/auth/code', { body: { code } })); return }
      const r = await api<Ik | Stap>('/auth/login', { body: { email, wachtwoord: ww } })
      if ('stap' in r) { setStap(r); setCode('') } else onIn(r)
    } catch (e) {
      const f = e as ApiFout
      setFout(f.message)
      if (stap && f.status === 401) { setStap(null); setWw('') }
    } finally { setBezig(false) }
  }
  const google = () => { location.href = `/api/auth/google?terug=${encodeURIComponent(location.pathname)}` }
  const alleenGoogle = methoden?.google && !methoden.wachtwoord
  return (
    <div className="login-scherm">
      <div className="bol bol-a" style={{ opacity: .6 }} />
      <div className="bol bol-b" style={{ opacity: .6 }} />
      <form className="card login" onSubmit={in_}>
        <Logo />
        <h1>{titel}</h1>
        {stap ? (
          <>
            {stap.stap === 'koppelen' ? (
              <>
                <p>Stel eenmalig tweestapsverificatie in. Scan de code met een authenticator-app (bijvoorbeeld Google Authenticator of Microsoft Authenticator) en vul de zes cijfers in.</p>
                {qr && <div className="totp-qr" dangerouslySetInnerHTML={{ __html: qr }} />}
                <p className="tekst-klein">Lukt scannen niet? Voer deze sleutel in: <code className="totp-sleutel">{stap.geheim.replace(/(.{4})/g, '$1 ').trim()}</code></p>
              </>
            ) : <p>Vul de zes cijfers in uit je authenticator-app.</p>}
            <label className="veld"><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required /></label>
            {fout && <div className="melding-blok fout">{fout}</div>}
            <button className="btn btn-pink btn-block" type="submit" disabled={bezig}>Bevestigen</button>
            <button type="button" className="link-terug" style={{ marginTop: 8 }} onClick={() => { setStap(null); setFout(null); setWw('') }}>Terug naar inloggen</button>
          </>
        ) : (
          <>
            <p>{vergeten ? 'Vul je e-mailadres in. Je krijgt een link om een nieuw wachtwoord te kiezen.' : 'Log in met je persoonlijke account.'}</p>
            {methoden?.google && !vergeten && (
              <>
                <button type="button" className="btn btn-cyan btn-block" onClick={google}>Inloggen met Google{methoden.domein ? ` (${methoden.domein})` : ''}</button>
                {!alleenGoogle && <div className="login-of"><span>of met e-mail en wachtwoord</span></div>}
              </>
            )}
            {alleenGoogle ? (fout && <div className="melding-blok fout" style={{ marginTop: 14 }}>{fout}</div>) : verstuurd ? <div className="melding-blok ok">Als dit adres bij ons bekend is, is er een e-mail met een link verstuurd.</div> : (
              <>
                <label className="veld"><span>E-mailadres</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
                {!vergeten && <label className="veld"><span>Wachtwoord</span><input type="password" value={ww} onChange={(e) => setWw(e.target.value)} autoComplete="current-password" required /></label>}
                {fout && <div className="melding-blok fout">{fout}</div>}
                <button className={`btn ${methoden?.google ? 'btn-ghost' : 'btn-pink'} btn-block`} type="submit" disabled={bezig}>{vergeten ? 'Stuur link' : 'Inloggen'}</button>
              </>
            )}
            {!alleenGoogle && (
              <button type="button" className="link-terug" style={{ marginTop: 8 }} onClick={() => { setVergeten(!vergeten); setVerstuurd(false); setFout(null) }}>
                {vergeten ? 'Terug naar inloggen' : 'Wachtwoord vergeten?'}
              </button>
            )}
          </>
        )}
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

/** bijInactiviteit: 'uitloggen' (beheer) of 'vergrendelen' (medewerkersscherm aan de bar), IT-beleid 8.5. */
export function Afgeschermd({ titel, rollen, bijInactiviteit = 'uitloggen', children }: { titel: string; rollen: string[]; bijInactiviteit?: 'uitloggen' | 'vergrendelen'; children: (ik: Ik, uit: () => void) => React.ReactNode }) {
  const { ik, setIk, uit, vergrendeld, vergrendel } = useIk()
  const minuten = !ik ? 0 : bijInactiviteit === 'vergrendelen' ? ik.inactief?.medewerker_min ?? 0 : ik.inactief?.beheer_min ?? 0
  useInactief(minuten, () => (bijInactiviteit === 'vergrendelen' ? vergrendel() : uit()))
  if (ik === undefined) return <div className="login-scherm"><Laden /></div>
  if (!ik && vergrendeld) return <Ontgrendelen titel={titel} v={vergrendeld} onIn={setIk} uit={uit} />
  if (!ik) return <Login titel={titel} onIn={setIk} />
  if (!heeftRol(ik, ...rollen)) return (
    <div className="login-scherm"><div className="card login"><Logo /><h1>Geen toegang</h1><p>Je account heeft niet de juiste rol voor dit scherm.</p><button className="btn btn-ghost" onClick={uit}>Uitloggen</button></div></div>
  )
  return <>{children(ik, uit)}</>
}
