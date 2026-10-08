// Albumkaart (hoes met artiest en titel) en de knop "Aanvragen".
import { useNavigate } from 'react-router-dom'
import { Bookmark, Check, Plus } from 'lucide-react'
import { Hoes } from '../components/Hoes'
import { Beschikbaarheid } from '../components/Iconen'
import { useKiosk } from './KioskApp'
import { t } from './taal'

const REDEN = { nummer: 'Nummer: {x}', componist: 'Componist: {x}', met: 'Met: {x}', label: 'Label: {x}' } as const

export type Kaart = { id: number; titel: string; artiesten: string; jaar: number | null; drager: string | null; hoes: string | null; beschikbaar: boolean; reden?: { soort: 'nummer' | 'componist' | 'met' | 'label'; tekst: string } }

export function AlbumKaart({ k, voet = false }: { k: Kaart; voet?: boolean }) {
  const nav = useNavigate()
  return (
    <div className="album-kaart">
      <button style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => nav(`/album/${k.id}`)} aria-label={`${k.artiesten} – ${k.titel}`}>
        <Hoes src={k.hoes} alt="" />
        <div className="a">{k.artiesten || t('Diverse artiesten')}</div>
        <div className="t">{k.titel}</div>
        {k.reden && <div className="reden">{t(REDEN[k.reden.soort], { x: k.reden.tekst })}</div>}
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
  const { mand, voegToe, toast, config, bewaard, bewaar } = useKiosk()
  const in_ = mand.some((m) => m.titel_id === k.id)
  // Bij het maximum: bewaren voor later in plaats van aanvragen (7.8, verbetering 4).
  const vol = !in_ && mand.length >= config.instellingen.max_titels
  if (vol && k.beschikbaar) {
    const al = bewaard.some((b) => b.titel_id === k.id)
    return (
      <button className={`aanvraag-mini bewaar ${al ? 'in' : ''}`} disabled={al} aria-label={al ? t('Bewaard voor later') : t('Bewaar {titel} voor later', { titel: k.titel })}
        onClick={() => bewaar({ titel_id: k.id, titel: k.titel, artiesten: k.artiesten, drager: k.drager, jaar: k.jaar, hoes: k.hoes })}>
        {al ? <><Check size={16} /> {t('Bewaard')}</> : <><Bookmark size={16} /> {t('Bewaar')}</>}
      </button>
    )
  }
  return (
    <button
      className={`aanvraag-mini ${in_ ? 'in' : ''}`} disabled={!k.beschikbaar && !in_}
      style={vol ? { background: 'var(--surface-2)', color: 'var(--dim)' } : undefined} aria-disabled={vol}
      onClick={() => { if (vol) { toast(t('Je aanvraag is vol: maximaal {n} titels.', { n: config.instellingen.max_titels })); return } if (!in_ && voegToe({ titel_id: k.id, titel: k.titel, artiesten: k.artiesten, drager: k.drager, jaar: k.jaar, hoes: k.hoes })) toast(t('{titel} staat in je aanvraag', { titel: k.titel })) }}
      aria-label={in_ ? t('Staat in je aanvraag') : k.beschikbaar ? t('Vraag {titel} aan', { titel: k.titel }) : t('In gebruik')}
    >
      {in_ ? <><Check size={16} /> {t('Gekozen')}</> : k.beschikbaar ? <><Plus size={16} /> {t('Aanvragen')}</> : t('In gebruik')}
    </button>
  )
}
