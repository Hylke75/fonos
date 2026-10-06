// Albumkaart (hoes met artiest en titel) en de knop "Aanvragen".
import { useNavigate } from 'react-router-dom'
import { Check, Plus } from 'lucide-react'
import { Hoes } from '../components/Hoes'
import { Beschikbaarheid } from '../components/Iconen'
import { useKiosk } from './KioskApp'

export type Kaart = { id: number; titel: string; artiesten: string; jaar: number | null; drager: string | null; hoes: string | null; beschikbaar: boolean }

export function AlbumKaart({ k, voet = false }: { k: Kaart; voet?: boolean }) {
  const nav = useNavigate()
  return (
    <div className="album-kaart">
      <button style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => nav(`/album/${k.id}`)} aria-label={`${k.artiesten} – ${k.titel}`}>
        <Hoes src={k.hoes} alt="" />
        <div className="a">{k.artiesten || 'Diverse artiesten'}</div>
        <div className="t">{k.titel}</div>
      </button>
      {voet && (
        <div className="kaart-voet">
          <Beschikbaarheid drager={k.drager} beschikbaar={k.beschikbaar} tekst={false} />
          <span className="dim" style={{ fontSize: 13 }}>{k.jaar ?? ''}</span>
          <AanvraagMini k={k} />
        </div>
      )}
    </div>
  )
}

export function AanvraagMini({ k }: { k: Kaart }) {
  const { mand, voegToe, toast, config } = useKiosk()
  const in_ = mand.some((m) => m.titel_id === k.id)
  // Bij het maximum: uitgeschakeld, met uitleg bij aantikken (7.8).
  const vol = !in_ && mand.length >= config.instellingen.max_titels
  return (
    <button
      className={`aanvraag-mini ${in_ ? 'in' : ''}`} disabled={!k.beschikbaar && !in_}
      style={vol ? { background: 'var(--surface-2)', color: 'var(--dim)' } : undefined} aria-disabled={vol}
      onClick={() => { if (vol) { toast(`Je aanvraag is vol: maximaal ${config.instellingen.max_titels} titels.`); return } if (!in_ && voegToe({ titel_id: k.id, titel: k.titel, artiesten: k.artiesten, drager: k.drager, jaar: k.jaar, hoes: k.hoes })) toast(`${k.titel} staat in je aanvraag`) }}
      aria-label={in_ ? 'Staat in je aanvraag' : k.beschikbaar ? `Vraag ${k.titel} aan` : 'In gebruik'}
    >
      {in_ ? <><Check size={16} /> Gekozen</> : k.beschikbaar ? <><Plus size={16} /> Aanvragen</> : 'In gebruik'}
    </button>
  )
}
