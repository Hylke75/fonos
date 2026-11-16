// Homepagina (7.3): zoekbalk, genreknoppen, rijen met hoezen, "Verras me" en "Lezen tijdens het luisteren".
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, ChevronRight, Compass, Shuffle } from 'lucide-react'
import { api } from '../api'
import { Laden } from '../components/Iconen'
import { useKiosk } from './KioskApp'
import { KioskKop } from './Kop'
import { AlbumKaart, type Kaart } from './Kaarten'
import { huidigeTaal, t } from './taal'
import { Keuzehulp } from './Keuzehulp'

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
          aria-pressed={actief === k.id} onClick={() => (actief === k.id ? uit() : nav(`/zoeken?knop=${k.id}`))}>
          {k.beeld && <img src={k.beeld} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
          <span className="label">{k.naam}</span>
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
    <section className="redactie" aria-label={titel || t('Over de Fonotheek')}>
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
  const verras = async () => {
    try { const r = await api<{ id: number }>('/kiosk/verras'); nav(`/album/${r.id}`) } catch { /* niets gevonden */ }
  }
  return (
    <div className="kiosk-scherm">
      <KioskKop />
      <main className="kiosk-inhoud">
        <Redactie />
        <GenreTegels />
        <div className="acties-rij">
          <button className="btn btn-pink" onClick={verras}><Shuffle size={20} /> {t('Verras me')}</button>
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
      </main>
      {hulp && <Keuzehulp onSluit={() => setHulp(false)} />}
    </div>
  )
}
