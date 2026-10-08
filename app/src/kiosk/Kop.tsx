// Kopbalk van de kiosk: logo, zoekbalk met suggesties, taal en aanvraaglijst.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, Disc3, Search, ShoppingBag, Type, X } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Hoes } from '../components/Hoes'
import { api, bestelnr } from '../api'
import { useKiosk } from './KioskApp'
import { t } from './taal'

/** Taalknop NL/EN (verbetering 5): na het wissen van de sessie weer Nederlands. */
export function TaalKnop() {
  const { taal, kiesTaal } = useKiosk()
  return (
    <button className="badge-nl taal-knop" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); kiesTaal(taal === 'nl' ? 'en' : 'nl') }}
      aria-label={taal === 'nl' ? t('Taal: Nederlands. Tik voor Engels') : t('Taal: Engels. Tik voor Nederlands')}>
      <span className={taal === 'nl' ? 'aan' : ''}>NL</span><span className={taal === 'en' ? 'aan' : ''}>EN</span>
    </button>
  )
}

/** Grotere tekst en meer contrast (verbetering 6). */
export function TekstKnop() {
  const { groot, zetGroot } = useKiosk()
  return (
    <button className={`icon-btn tekst-knop ${groot ? 'aan' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); zetGroot(!groot) }}
      aria-pressed={groot} aria-label={t('Grotere tekst en meer contrast')} title={t('Grotere tekst en meer contrast')}>
      <Type size={22} />
    </button>
  )
}

export function MandKnop() {
  const { mand } = useKiosk()
  return (
    <Link to="/aanvraag" className="icon-btn mand-knop" aria-label={t('Jouw aanvraag, {n} titels', { n: mand.length })}>
      <ShoppingBag size={22} />
      {mand.length > 0 && <span className="teller">{mand.length}</span>}
    </Link>
  )
}

const STATUS: Record<string, string> = { nieuw: 'Ingediend', bezig: 'Wordt opgehaald', klaar: 'Bij je speler' }
const statusTekst = (s: string) => (STATUS[s] ? t(STATUS[s]) : s)

/** Status van de eigen aanvraag (verbetering 2): ingediend, wordt opgehaald, bij je speler. */
export function AanvraagStatus() {
  const { mijnAanvraag: a } = useKiosk()
  const [open, setOpen] = useState(false)
  if (!a) return null
  return (
    <>
      <button className={`aanvraag-status st-${a.status}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('Aanvraag {nr}: {status}', { nr: bestelnr(a.bestelnummer), status: statusTekst(a.status) })}>
        <Clock size={18} /> {bestelnr(a.bestelnummer)} · {statusTekst(a.status)}
      </button>
      {open && (
        <div className="card status-paneel" role="dialog" aria-label={t('Je aanvraag')}>
          <h3>{t('Aanvraag {nr}: {status}', { nr: bestelnr(a.bestelnummer), status: statusTekst(a.status) })}</h3>
          {a.items.map((i) => (
            <div key={i.id} className={`regel ${i.verwijderd ? 'weg' : ''}`}>
              <Hoes src={i.hoes} />
              <div><div>{i.artiesten || t('Diverse artiesten')}</div><div className="muted">{i.titel}</div>
                {!!i.verwijderd && <div className="tekst-klein" style={{ color: 'var(--red)' }}>{t('Niet beschikbaar')}{i.reden ? `: ${i.reden}` : ''}</div>}</div>
            </div>
          ))}
          <button className="btn btn-ghost btn-s" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>{t('Sluiten')}</button>
        </div>
      )}
    </>
  )
}

/** Gekozen platenspeler; tikken = vrijgeven (na bevestiging). */
export function SpelerKnop() {
  const { speler, vraagVrijgeven } = useKiosk()
  if (!speler) return null
  return (
    <button className="speler-knop" onClick={vraagVrijgeven} aria-label={t('Platenspeler {n} vrijgeven', { n: speler.nummer })}>
      <Disc3 size={20} /> {t('Speler')} <b>{speler.nummer}</b> · {t('Vrijgeven')}
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
          placeholder={t('Zoek op artiest, album, genre of titel…')} aria-label={t('Zoeken')} enterKeyHint="search" autoComplete="off" spellCheck={false}
        />
        {q && <button type="button" className="icon-btn wis" style={{ border: 0, background: 'none' }} aria-label={t('Wissen')} onClick={() => { setQ(''); setS(null) }}><X size={20} /></button>}
      </form>
      {open && heeft && (
        <div className="suggesties" role="listbox">
          {s!.artiesten.length > 0 && <div className="kop">{t('Artiesten')}</div>}
          {s!.artiesten.map((a) => (
            <button key={a} onClick={() => { setOpen(false); nav(`/artiest/${encodeURIComponent(a)}`) }}><Search size={18} className="dim" />{a}</button>
          ))}
          {s!.titels.length > 0 && <div className="kop">{t('Albums')}</div>}
          {s!.titels.map((t) => (
            <button key={t.id} onClick={() => { setOpen(false); nav(`/album/${t.id}`) }}>
              <Hoes src={t.hoes} />
              <span><b style={{ fontWeight: 600 }}>{t.titel}</b><br /><span className="muted" style={{ fontSize: 14 }}>{t.artiesten}</span></span>
            </button>
          ))}
          <button onClick={() => zoek()} style={{ color: 'var(--cyan)', fontWeight: 600 }}>{t('Alle resultaten voor “{q}”', { q })}</button>
        </div>
      )}
    </div>
  )
}

/** Kop met logo en zoekbalk (homepagina, resultaten). */
export function KioskKop({ zoekStart }: { zoekStart?: string }) {
  return (
    <header className="kiosk-header">
      <Link to="/home" aria-label={t('Naar de homepagina')}><Logo /></Link>
      <Zoekbalk start={zoekStart} />
      <div className="rechts" style={{ marginLeft: 0 }}>
        <AanvraagStatus />
        <SpelerKnop />
        <TekstKnop />
        <TaalKnop />
        <MandKnop />
      </div>
    </header>
  )
}

/** Kop met logo, terugknop en zoekicoon (album, artiest, aanvraag). */
export function KioskKopTerug({ tekst, naar, zoekIcoon = true, mand = true }: { tekst?: string; naar?: string; zoekIcoon?: boolean; mand?: boolean }) {
  const nav = useNavigate()
  tekst = t(tekst ?? 'Terug naar resultaten')
  return (
    <header className="kiosk-header">
      <Link to="/home" aria-label={t('Naar de homepagina')}><Logo /></Link>
      <button className="link-terug" onClick={() => (naar ? nav(naar) : window.history.length > 1 ? nav(-1) : nav('/home'))}><ArrowLeft size={20} /> {tekst}</button>
      <div className="rechts">
        <AanvraagStatus />
        <SpelerKnop />
        <TekstKnop />
        <TaalKnop />
        {zoekIcoon && <Link to="/home" className="icon-btn" aria-label={t('Zoeken')}><Search size={22} /></Link>}
        {mand && <MandKnop />}
      </div>
    </header>
  )
}
