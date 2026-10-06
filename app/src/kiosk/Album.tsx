// Albumpagina (7.6). Populair en klassiek; bij klassiek componisten en uitvoerenden waar de dump die levert.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, RotateCw, Sparkles, X } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Hoes } from '../components/Hoes'
import { Laden, SpeelIcoon } from '../components/Iconen'
import { useKiosk } from './KioskApp'
import { KioskKopTerug } from './Kop'

type Ex = { exemplaar_id: number; titel_id: number; drager: string | null; jaar: number | null; vindcode: string | null; beschikbaar: boolean; deze_titel: boolean }
export type AlbumData = {
  id: number; titelnummer: string | null; soort: string; jaar: number | null; fonos_verhaal: string | null; ai_tekst: boolean; beschikbaar: boolean
  velden: { titel?: string; artiesten?: string[]; uitgave?: string; drager?: string; aantal?: number; label?: string; genres?: string[]; speelduur?: string; toelichting?: string; tracklist?: { pos: number; titel: string; duur?: string | null; componisten?: string[]; uitvoerenden?: string[] }[]; hoes_voor?: string; hoes_achter?: string; componisten?: string[]; uitvoerenden?: string[] }
  exemplaren: Ex[]
}

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const uitgaveTekst = (u?: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(u ?? '')
  return m ? `${MAANDEN[Number(m[2]) - 1]} ${m[1]}` : u ?? ''
}
const dragerTekst = (d?: string | null, n?: number) => (d ? `${n && n > 1 ? `${n} × ` : ''}${d === 'Overig' ? 'overig' : d}` : '')

export function Album() {
  const { id } = useParams()
  const [a, setA] = useState<AlbumData | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const { versie } = useKiosk()
  useEffect(() => {
    setFout(null)
    api<AlbumData>(`/kiosk/titel/${id}`).then(setA).catch((e: ApiFout) => setFout(e.message))
  }, [id, versie])
  return (
    <div className="kiosk-scherm">
      <KioskKopTerug />
      <main className="kiosk-inhoud">
        {fout && <div className="leeg"><h2>{fout}</h2></div>}
        {!a && !fout && <Laden />}
        {a && <AlbumWeergave a={a} />}
      </main>
    </div>
  )
}

/** Ook gebruikt als voorbeeldweergave in het beheer. */
export function AlbumWeergave({ a, voorbeeld = false }: { a: AlbumData; voorbeeld?: boolean }) {
  const v = a.velden
  const nav = useNavigate()
  const ctx = useKiosk()
  const kiosk = voorbeeld ? null : ctx
  const [meer, setMeer] = useState(false)
  const [achter, setAchter] = useState(false)
  const eerste = a.exemplaren.find((e) => e.deze_titel && e.beschikbaar) ?? a.exemplaren.find((e) => e.beschikbaar)
  const [keuze, setKeuze] = useState<number | undefined>(eerste?.exemplaar_id)
  useEffect(() => setKeuze(eerste?.exemplaar_id), [a.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const gekozen = a.exemplaren.find((e) => e.exemplaar_id === keuze && e.beschikbaar)
  const inMand = kiosk?.mand.some((m) => m.titel_id === gekozen?.titel_id)
  const klassiek = a.soort === 'klassiek'
  const personen = klassiek && v.componisten?.length ? v.componisten : v.artiesten ?? []
  const vol = kiosk && kiosk.mand.length >= kiosk.config.instellingen.max_titels && !inMand

  const voegToe = () => {
    if (!kiosk || !gekozen) return
    const ok = kiosk.voegToe({
      titel_id: gekozen.titel_id, exemplaar_id: gekozen.exemplaar_id, titel: v.titel ?? '', artiesten: (v.artiesten ?? []).join(', '),
      drager: gekozen.drager, jaar: gekozen.jaar, hoes: v.hoes_voor, vindcode: gekozen.vindcode,
    })
    if (ok) kiosk.toast(`${v.titel} staat in je aanvraag`)
  }

  return (
    <div className="album-grid">
      <div>
        <div className="album-hoes"><Hoes src={achter ? v.hoes_achter : v.hoes_voor} alt={achter ? 'Achterzijde van de hoes' : 'Hoes'} /></div>
        {v.hoes_achter && (
          <button className="btn btn-ghost btn-s" style={{ marginTop: 14, minHeight: 44 }} onClick={() => setAchter(!achter)}>
            <RotateCw size={16} /> {achter ? 'Toon voorzijde' : 'Toon achterzijde'}
          </button>
        )}
      </div>

      <div className="album-info">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {personen.length === 0 && <span className="artiest">Diverse artiesten</span>}
          {personen.slice(0, 4).map((p, i) => (
            <button key={p} className="artiest" onClick={() => !voorbeeld && nav(`/artiest/${encodeURIComponent(p)}`)}>{p}{i < Math.min(personen.length, 4) - 1 ? ',' : ''}</button>
          ))}
        </div>
        <h1>{v.titel}</h1>
        <div className="tags">
          {(a.jaar || v.uitgave) && <span className="pill">{a.jaar ?? v.uitgave}</span>}
          {(v.genres ?? []).slice(0, 2).map((g) => <span key={g} className="pill">{g}</span>)}
          {v.drager && <span className="pill">{dragerTekst(v.drager, v.aantal)}</span>}
        </div>
        {v.toelichting && (
          <>
            {a.ai_tekst && <div className="ai-label"><Sparkles size={14} /> Tekst gegenereerd met AI</div>}
            <div className={`toelichting ${meer ? '' : 'kort'}`}>{v.toelichting}</div>
          </>
        )}
        <button className="btn btn-ghost btn-s" style={{ marginTop: 22, minHeight: 48, padding: '0 22px' }} onClick={() => setMeer(!meer)} aria-expanded={meer}>
          Meer informatie {meer ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {meer && (
          <>
            <dl className="meer-info">
              {klassiek && v.componisten?.length ? <><dt>Componist(en)</dt><dd>{v.componisten.join(', ')}</dd></> : null}
              {klassiek && v.uitvoerenden?.length ? <><dt>Uitvoerenden</dt><dd>{v.uitvoerenden.slice(0, 12).join(', ')}{v.uitvoerenden.length > 12 ? ' …' : ''}</dd></> : null}
              {klassiek && v.artiesten?.length ? <><dt>Op de hoes</dt><dd>{v.artiesten.join(', ')}</dd></> : null}
              {v.uitgave && <><dt>Uitgebracht</dt><dd>{uitgaveTekst(v.uitgave)}</dd></>}
              {v.genres?.length ? <><dt>Genres</dt><dd>{v.genres.join(', ')}</dd></> : null}
              {v.label && <><dt>Label</dt><dd>{v.label}</dd></>}
              {v.drager && <><dt>Drager</dt><dd>{dragerTekst(v.drager, v.aantal)}</dd></>}
              {v.speelduur && <><dt>Speelduur</dt><dd>{v.speelduur}</dd></>}
            </dl>
            {a.fonos_verhaal && <div className="fonos-verhaal"><h3>Het verhaal van Fonos</h3>{a.fonos_verhaal}</div>}
          </>
        )}
        {!meer && a.fonos_verhaal && <div className="fonos-verhaal"><h3>Het verhaal van Fonos</h3>{a.fonos_verhaal}</div>}

        {(v.tracklist?.length ?? 0) > 0 && (
          <section className="nummers">
            <h2>Nummers</h2>
            {v.tracklist!.map((t, i) => (
              <div className="nummer" key={i}>
                <span className="speel" aria-hidden="true"><SpeelIcoon /></span>
                <span className="nr">{t.pos}</span>
                <span>{t.titel}{klassiek && (t.componisten?.length || t.uitvoerenden?.length) ? <span className="sub">{[t.componisten?.join(', '), t.uitvoerenden?.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</span> : null}</span>
                <span className="duur">{t.duur ?? ''}</span>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="exemplaren-kolom">
        <div className="card exemplaren-paneel">
          <h2>Beschikbare exemplaren</h2>
          {a.exemplaren.length === 0 && <p className="muted">Geen exemplaren in de collectie.</p>}
          {a.exemplaren.map((e) => (
            <button key={e.exemplaar_id} className={`exemplaar ${keuze === e.exemplaar_id ? 'gekozen' : ''}`} disabled={!e.beschikbaar}
              onClick={() => setKeuze(e.exemplaar_id)} role="radio" aria-checked={keuze === e.exemplaar_id}>
              <span className="radio">{keuze === e.exemplaar_id && <SpeelIcoon />}</span>
              <span>
                <div className="wat">{e.drager ?? ''} {e.jaar ?? ''}{!e.deze_titel ? ' (andere uitgave)' : ''}</div>
                <div className="code">{ctx.config.instellingen.vindcode_label}: {e.vindcode ?? '–'}</div>
                {!e.beschikbaar && <div className="in-gebruik">In gebruik</div>}
              </span>
              <span className={`stip ${e.beschikbaar ? 'ja' : 'nee'}`} aria-label={e.beschikbaar ? 'Beschikbaar' : 'In gebruik'}>
                {!e.beschikbaar && <X size={12} strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
        {!voorbeeld && (
          <div className="paneel-knop">
            <button className="btn btn-pink btn-l btn-block" disabled={!gekozen || inMand || !!vol} onClick={voegToe}>
              {inMand ? 'Staat in je aanvraag' : gekozen ? 'Voeg toe aan aanvraag' : 'Nu in gebruik'}
            </button>
            {vol && <p className="melding">Je aanvraag is vol: maximaal {kiosk!.config.instellingen.max_titels} titels. Haal er eerst een uit je aanvraag.</p>}
            {inMand && <p className="melding"><button className="link-terug" style={{ margin: '0 auto', color: 'var(--cyan)' }} onClick={() => nav('/aanvraag')}>Naar je aanvraag</button></p>}
          </div>
        )}
      </div>
    </div>
  )
}
