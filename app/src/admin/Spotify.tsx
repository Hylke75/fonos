// Spotify-koppelingen: controlelijst van twijfelgevallen en recente automatische koppelingen.
// Per titel de eigen hoes en gegevens naast de Spotify-kandidaten, met Goedkeuren, Andere kandidaat, Geen match en Uitsluiten.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, ExternalLink, Ban, X } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Hoes } from '../components/Hoes'
import { Laden } from '../components/Iconen'
import { Melding, ZoekVeld } from './ui'

const STATUSSEN: [string, string][] = [
  ['twijfel', 'Twijfel'], ['auto_goed', 'Automatisch goed'], ['handmatig', 'Handmatig'], ['geen', 'Geen match'], ['uitgesloten', 'Uitgesloten'], ['nog_niet', 'Nog niet gezocht'],
]

export function Spotify() {
  const [p, setP] = useSearchParams()
  const status = p.get('status') ?? 'twijfel'
  const pagina = Number(p.get('pagina') ?? 1)
  const zoek = p.get('zoek') ?? ''
  const [d, setD] = useState<any>(null)
  const [m, setM] = useState<any>(null)
  const laad = () => api(`/beheer/spotify?status=${status}&pagina=${pagina}&zoek=${encodeURIComponent(zoek)}`).then(setD)
  useEffect(() => { setD(null); laad() }, [status, pagina, zoek]) // eslint-disable-line react-hooks/exhaustive-deps
  const zet = (k: string, v: string) => { const n = new URLSearchParams(p); v ? n.set(k, v) : n.delete(k); if (k !== 'pagina') n.delete('pagina'); setP(n, { replace: true }) }

  const doe = async (id: number, body: any, tekst: string) => {
    setM(null)
    try {
      await api(`/beheer/spotify/${id}`, { body })
      setD((x: any) => ({ ...x, rijen: x.rijen.filter((r: any) => r.id !== id || status === 'handmatig') }))
      setM({ soort: 'ok', tekst })
      api(`/beheer/spotify?status=${status}&pagina=${pagina}&zoek=${encodeURIComponent(zoek)}`).then((n) => setD((x: any) => ({ ...x, tellingen: n.tellingen, totaal: n.totaal })))
    } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }

  const tel = d?.tellingen ?? {}
  const totaal = Object.values(tel).reduce((a: number, b: any) => a + b, 0) as number
  const gedaan = totaal - (tel.nog_niet ?? 0)
  return (
    <>
      <h1>Spotify-koppelingen</h1>
      <p className="muted" style={{ marginTop: -8 }}>Gekoppelde albums krijgen op de albumpagina in de kiosk een Spotify-speler en een QR-code naar de telefoon.</p>
      {d && (
        <div className="card paneel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <b>Voortgang: {gedaan.toLocaleString('nl-NL')} van {totaal.toLocaleString('nl-NL')} titels beoordeeld</b>
            <span className="muted">{totaal ? Math.round((gedaan / totaal) * 100) : 0}%</span>
          </div>
          <div className="voortgang"><div style={{ width: `${totaal ? (gedaan / totaal) * 100 : 0}%` }} /></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {STATUSSEN.map(([k, l]) => (
              <button key={k} className={`chip ${status === k ? 'aan' : ''}`} onClick={() => zet('status', k)}>{l} <b style={{ marginLeft: 4 }}>{(tel[k] ?? 0).toLocaleString('nl-NL')}</b></button>
            ))}
          </div>
        </div>
      )}
      <div className="werkbalk"><ZoekVeld waarde={zoek} onChange={(v) => zet('zoek', v)} placeholder="Zoek op titel of artiest" /></div>
      <Melding m={m} />
      {!d ? <Laden /> : d.rijen.length === 0 ? <p className="muted" style={{ padding: 24 }}>Geen titels met deze status.</p> : (
        <div className="spotify-lijst">
          {d.rijen.map((r: any) => <Regel key={r.id} r={r} doe={doe} />)}
        </div>
      )}
      {d && d.totaal > d.per && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: 20 }}>
          <button className="btn btn-ghost btn-s" disabled={pagina <= 1} onClick={() => zet('pagina', String(pagina - 1))}>Vorige</button>
          <span className="muted" style={{ alignSelf: 'center' }}>Pagina {pagina} van {Math.ceil(d.totaal / d.per)}</span>
          <button className="btn btn-ghost btn-s" disabled={pagina * d.per >= d.totaal} onClick={() => zet('pagina', String(pagina + 1))}>Volgende</button>
        </div>
      )}
    </>
  )
}

function Regel({ r, doe }: { r: any; doe: (id: number, body: any, tekst: string) => void }) {
  const huidig = r.spotify_album_id ?? r.kandidaten[0]?.id
  return (
    <div className="card spotify-regel">
      <div className="eigen">
        <Hoes src={r.hoes} />
        <div>
          <div className="muted tekst-klein">Fonos</div>
          <Link to={`/beheer/titel/${r.id}`}><b>{r.titel}</b></Link>
          <div>{r.artiesten || 'Diverse artiesten'}</div>
          <div className="muted tekst-klein">{[r.jaar, r.label, r.titelnummer].filter(Boolean).join(' · ')}</div>
          {r.spotify_score != null && <div className="muted tekst-klein">Score {Math.round(r.spotify_score * 100)}%</div>}
        </div>
      </div>
      <div className="kandidaten">
        {r.kandidaten.length === 0 && <p className="muted">Geen kandidaten gevonden op Spotify.</p>}
        {r.kandidaten.map((k: any) => (
          <div key={k.id} className={`kandidaat ${k.id === huidig ? 'huidig' : ''}`}>
            <Hoes src={k.cover} />
            <div className="tekst-klein">
              <b>{k.titel}</b><div>{k.artiest}</div><div className="muted">{k.jaar ?? ''}{k.score != null ? ` · ${Math.round(k.score * 100)}%` : ''}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {k.id !== huidig && <button className="btn btn-ghost btn-s" onClick={() => doe(r.id, { actie: 'kies', album_id: k.id }, `"${r.titel}" gekoppeld aan "${k.titel}".`)}>Deze kiezen</button>}
                <a className="btn btn-ghost btn-s" href={`https://open.spotify.com/album/${k.id}`} target="_blank" rel="noreferrer" aria-label="Openen op Spotify"><ExternalLink size={14} /></a>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="acties">
        {huidig && <button className="btn btn-cyan btn-s" onClick={() => doe(r.id, { actie: 'goedkeuren' }, `"${r.titel}" goedgekeurd.`)}><Check size={14} /> Goedkeuren</button>}
        <button className="btn btn-ghost btn-s" onClick={() => doe(r.id, { actie: 'geen' }, `"${r.titel}": geen match.`)}><X size={14} /> Geen match</button>
        <button className="btn btn-ghost btn-s" onClick={() => doe(r.id, { actie: 'uitsluiten' }, `"${r.titel}" uitgesloten.`)}><Ban size={14} /> Uitsluiten</button>
      </div>
    </div>
  )
}
