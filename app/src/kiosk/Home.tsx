// Homepagina (7.3): zoekbalk, genreknoppen, rijen met hoezen, "Verras me" en "Lezen tijdens het luisteren".
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, ChevronRight, Compass, Shuffle, X } from 'lucide-react'
import { api } from '../api'
import { Laden } from '../components/Iconen'
import { useKiosk } from './KioskApp'
import { KioskKop } from './Kop'
import { AlbumKaart, type Kaart } from './Kaarten'
import { huidigeTaal, t } from './taal'
import { Keuzehulp } from './Keuzehulp'
import { viaApp } from '../components/hoesUrl'

export function GenreTegels({ actief }: { actief?: number }) {
  const { config } = useKiosk()
  const nav = useNavigate()
  const [p] = useSearchParams()
  // Nog eens tikken op het actieve genre zet het weer uit (met behoud van de zoekopdracht, als die er is).
  const uit = () => {
    const n = new URLSearchParams(p); n.delete('knop'); n.delete('sub')
    nav(n.get('q') || n.get('selectie') ? `/zoeken?${n}` : '/home')
  }
  return (
    <div className="genres" role="group" aria-label={t('Genres')}>
      {config.knoppen.map((k) => (
        <button key={k.id} className={`genretegel ${actief === k.id ? 'actief' : ''}`}
          style={{ ['--k' as any]: k.kleur, borderColor: `color-mix(in srgb, ${k.kleur} 70%, #fff 30%)` }}
          aria-pressed={actief === k.id} aria-label={actief === k.id ? t('{naam}: gekozen. Tik om dit genre uit te zetten', { naam: k.naam }) : k.naam}
          onClick={() => (actief === k.id ? uit() : nav(`/zoeken?knop=${k.id}`))}>
          {k.beeld && <img src={viaApp(k.beeld)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
          <span className="label">{k.naam}</span>
          {/* Zichtbaar dat je het gekozen genre weer kunt uitzetten. */}
          {actief === k.id && <span className="tegel-uit" aria-hidden="true"><X size={18} strokeWidth={3} /></span>}
        </button>
      ))}
    </div>
  )
}

/** Redactioneel blok bovenaan: wat dit deel van de collectie is (tekst in Beheer → Instellingen). */
function Redactie() {
  const { instellingen: i } = useKiosk().config
  const en = huidigeTaal() === 'en'
  const titel = (en && i.redactie_titel_en) || i.redactie_titel
  const tekst = (en && i.redactie_tekst_en) || i.redactie_tekst
  if (!titel && !tekst) return null
  return (
    <section className="redactie" aria-label={titel || t('Over de Luisterbar')}>
      {titel && <h1>{titel}</h1>}
      {tekst && <p>{tekst}</p>}
    </section>
  )
}

export function Home() {
  const { versie, config } = useKiosk()
  const [rijen, setRijen] = useState<{ id: number; naam: string; titels: Kaart[] }[] | null>(null)
  const nav = useNavigate()
  const [hulp, setHulp] = useState(false)
  useEffect(() => { api('/kiosk/home').then((d) => setRijen(d.rijen)).catch(() => setRijen((r) => r ?? [])) }, [versie])
  const [verrasOpen, setVerrasOpen] = useState(false)
  return (
    <div className="kiosk-scherm">
      <KioskKop />
      <main className="kiosk-inhoud">
        <Redactie />
        <GenreTegels />
        <div className="acties-rij">
          <button className="btn btn-pink" onClick={() => setVerrasOpen(true)} aria-haspopup="dialog"><Shuffle size={20} /> {t('Verras me')}</button>
          <button className="btn btn-ghost" onClick={() => setHulp(true)}><Compass size={20} /> {t('Help me kiezen')}</button>
          {config.instellingen.fonos_paginas.length > 0 && (
            <button className="btn btn-ghost" onClick={() => nav('/lezen')}><BookOpen size={20} /> {t('Lezen tijdens het luisteren')}</button>
          )}
        </div>
        {!rijen && <Laden />}
        {rijen?.map((r) => (
          <section key={r.id} aria-label={r.naam}>
            <button className="sectie-kop" onClick={() => nav(`/zoeken?selectie=${r.id}&naam=${encodeURIComponent(r.naam)}`)}>{r.naam} <ChevronRight size={22} /></button>
            <div className="rij">{r.titels.map((k) => <AlbumKaart key={k.id} k={k} />)}</div>
          </section>
        ))}
        <InstagramBlok />
      </main>
      {hulp && <Keuzehulp onSluit={() => setHulp(false)} />}
      {verrasOpen && <VerrasKeuze onSluit={() => setVerrasOpen(false)} />}
    </div>
  )
}

/** "Verras me": eerst een genre kiezen (of alles), dan een willekeurige beschikbare plaat uit dat genre. */
function VerrasKeuze({ onSluit }: { onSluit: () => void }) {
  const { config } = useKiosk()
  const nav = useNavigate()
  const [niets, setNiets] = useState(false)
  useEffect(() => {
    const toets = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', toets)
    return () => window.removeEventListener('keydown', toets)
  }, [onSluit])
  const verras = async (knop?: number) => {
    setNiets(false)
    try { const r = await api<{ id: number }>(`/kiosk/verras${knop ? `?knop=${knop}` : ''}`); onSluit(); nav(`/album/${r.id}`) } catch { setNiets(true) }
  }
  return (
    <div className="modal-achter" onClick={onSluit}>
      <div className="card modal verras-keuze" role="dialog" aria-modal="true" aria-labelledby="verras-titel" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sluit" aria-label={t('Sluiten')} onClick={onSluit}><X size={22} /></button>
        <h2 id="verras-titel"><Shuffle size={24} /> {t('Waarmee wil je verrast worden?')}</h2>
        <div className="verras-genres">
          {config.knoppen.map((k) => (
            <button key={k.id} className="verras-genre" style={{ ['--k' as any]: k.kleur }} onClick={() => verras(k.id)}>{k.naam}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-l btn-block" onClick={() => verras()}>{t('Uit alle genres')}</button>
        {niets && <p className="melding" role="status">{t('In dit genre is nu niets beschikbaar. Kies een ander genre.')}</p>}
      </div>
    </div>
  )
}

/** Volg Fonos op Instagram: een QR-code, want op de kiosktablet zelf wil je de app niet verlaten (adres in Beheer → Instellingen). */
function InstagramBlok() {
  const url = useKiosk().config.instellingen.instagram_url?.trim()
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    if (!url) return
    let weg = false
    import('qrcode').then((Q) => Q.toString(url, { type: 'svg', margin: 1, width: 132, color: { dark: '#040a1e', light: '#ffffff' } }))
      .then((svg) => { if (!weg) setQr(svg) }).catch(() => {})
    return () => { weg = true }
  }, [url])
  if (!url) return null
  const account = url.replace(/^https:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')
  return (
    <section className="instagram-blok" aria-label={t('Volg Fonos op Instagram')}>
      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} aria-hidden="true" />}
      <div>
        <h2>{t('Volg Fonos op Instagram')}</h2>
        <p className="muted">{t('Scan de code met je telefoon.')}</p>
        <p className="account">@{account}</p>
      </div>
    </section>
  )
}
