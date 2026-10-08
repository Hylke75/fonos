// Homepagina (7.3): zoekbalk, genreknoppen, rijen met hoezen, "Verras me" en "Lezen tijdens het luisteren".
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ChevronRight, Shuffle } from 'lucide-react'
import { api } from '../api'
import { Laden } from '../components/Iconen'
import { useKiosk } from './KioskApp'
import { KioskKop } from './Kop'
import { AlbumKaart, type Kaart } from './Kaarten'
import { t } from './taal'

export function GenreTegels({ actief }: { actief?: number }) {
  const { config } = useKiosk()
  const nav = useNavigate()
  return (
    <div className="genres" role="list">
      {config.knoppen.map((k) => (
        <button key={k.id} role="listitem" className={`genretegel ${actief === k.id ? 'actief' : ''}`}
          style={{ ['--k' as any]: k.kleur, borderColor: `color-mix(in srgb, ${k.kleur} 70%, #fff 30%)` }}
          onClick={() => nav(`/zoeken?knop=${k.id}`)}>
          {k.beeld && <img src={k.beeld} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
          <span className="label">{k.naam}</span>
        </button>
      ))}
    </div>
  )
}

export function Home() {
  const { versie, config } = useKiosk()
  const [rijen, setRijen] = useState<{ id: number; naam: string; titels: Kaart[] }[] | null>(null)
  const nav = useNavigate()
  useEffect(() => { api('/kiosk/home').then((d) => setRijen(d.rijen)).catch(() => setRijen((r) => r ?? [])) }, [versie])
  const verras = async () => {
    try { const r = await api<{ id: number }>('/kiosk/verras'); nav(`/album/${r.id}`) } catch { /* niets gevonden */ }
  }
  return (
    <div className="kiosk-scherm">
      <KioskKop />
      <main className="kiosk-inhoud">
        <GenreTegels />
        <div className="acties-rij">
          <button className="btn btn-pink" onClick={verras}><Shuffle size={20} /> {t('Verras me')}</button>
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
    </div>
  )
}
