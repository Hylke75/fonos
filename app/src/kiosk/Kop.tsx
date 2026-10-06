// Kopbalk van de kiosk: logo, zoekbalk met suggesties, taal en aanvraaglijst.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Disc3, Search, ShoppingBag, X } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Hoes } from '../components/Hoes'
import { api } from '../api'
import { useKiosk } from './KioskApp'

export function MandKnop() {
  const { mand } = useKiosk()
  return (
    <Link to="/aanvraag" className="icon-btn mand-knop" aria-label={`Jouw aanvraag, ${mand.length} titels`}>
      <ShoppingBag size={22} />
      {mand.length > 0 && <span className="teller">{mand.length}</span>}
    </Link>
  )
}

/** Gekozen platenspeler; tikken = vrijgeven (na bevestiging). */
export function SpelerKnop() {
  const { speler, vraagVrijgeven } = useKiosk()
  if (!speler) return null
  return (
    <button className="speler-knop" onClick={vraagVrijgeven} aria-label={`Platenspeler ${speler.nummer} vrijgeven`}>
      <Disc3 size={20} /> Speler <b>{speler.nummer}</b> · Vrijgeven
    </button>
  )
}

export function Zoekbalk({ start = '', autoFocus = false }: { start?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState(start)
  const [s, setS] = useState<{ artiesten: string[]; titels: { id: number; titel: string; artiesten: string; hoes: string | null }[] } | null>(null)
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setQ(start), [start])
  useEffect(() => {
    if (q.trim().length < 2) { setS(null); return }
    const ac = new AbortController()
    const t = setTimeout(() => api(`/kiosk/suggesties?q=${encodeURIComponent(q)}`, { signal: ac.signal }).then(setS).catch(() => {}), 120)
    return () => { clearTimeout(t); ac.abort() }
  }, [q])
  useEffect(() => {
    const dicht = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', dicht)
    return () => window.removeEventListener('pointerdown', dicht)
  }, [])
  const zoek = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (q.trim().length < 2) return
    setOpen(false)
    ;(document.activeElement as HTMLElement)?.blur()
    nav(`/zoeken?q=${encodeURIComponent(q.trim())}`)
  }
  const heeft = s && (s.artiesten.length > 0 || s.titels.length > 0)
  return (
    <div className="zoekbalk" ref={ref}>
      <form onSubmit={zoek} role="search">
        <Search size={24} aria-hidden="true" />
        <input
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} autoFocus={autoFocus}
          placeholder="Zoek op artiest, album, genre of titel…" aria-label="Zoeken" enterKeyHint="search" autoComplete="off" spellCheck={false}
        />
        {q && <button type="button" className="icon-btn wis" style={{ border: 0, background: 'none' }} aria-label="Wissen" onClick={() => { setQ(''); setS(null) }}><X size={20} /></button>}
      </form>
      {open && heeft && (
        <div className="suggesties" role="listbox">
          {s!.artiesten.length > 0 && <div className="kop">Artiesten</div>}
          {s!.artiesten.map((a) => (
            <button key={a} onClick={() => { setOpen(false); nav(`/artiest/${encodeURIComponent(a)}`) }}><Search size={18} className="dim" />{a}</button>
          ))}
          {s!.titels.length > 0 && <div className="kop">Albums</div>}
          {s!.titels.map((t) => (
            <button key={t.id} onClick={() => { setOpen(false); nav(`/album/${t.id}`) }}>
              <Hoes src={t.hoes} />
              <span><b style={{ fontWeight: 600 }}>{t.titel}</b><br /><span className="muted" style={{ fontSize: 14 }}>{t.artiesten}</span></span>
            </button>
          ))}
          <button onClick={() => zoek()} style={{ color: 'var(--cyan)', fontWeight: 600 }}>Alle resultaten voor “{q}”</button>
        </div>
      )}
    </div>
  )
}

/** Kop met logo en zoekbalk (homepagina, resultaten). */
export function KioskKop({ zoekStart }: { zoekStart?: string }) {
  return (
    <header className="kiosk-header">
      <Link to="/home" aria-label="Naar de homepagina"><Logo /></Link>
      <Zoekbalk start={zoekStart} />
      <div className="rechts" style={{ marginLeft: 0 }}>
        <SpelerKnop />
        <span className="badge-nl" aria-label="Taal: Nederlands">NL</span>
        <MandKnop />
      </div>
    </header>
  )
}

/** Kop met logo, terugknop en zoekicoon (album, artiest, aanvraag). */
export function KioskKopTerug({ tekst = 'Terug naar resultaten', naar, zoekIcoon = true, mand = true }: { tekst?: string; naar?: string; zoekIcoon?: boolean; mand?: boolean }) {
  const nav = useNavigate()
  return (
    <header className="kiosk-header">
      <Link to="/home" aria-label="Naar de homepagina"><Logo /></Link>
      <button className="link-terug" onClick={() => (naar ? nav(naar) : window.history.length > 1 ? nav(-1) : nav('/home'))}><ArrowLeft size={20} /> {tekst}</button>
      <div className="rechts">
        <SpelerKnop />
        {zoekIcoon && <Link to="/home" className="icon-btn" aria-label="Zoeken"><Search size={22} /></Link>}
        {mand && <MandKnop />}
      </div>
    </header>
  )
}
