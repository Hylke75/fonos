// Resultaten en bladeren (7.5): raster of lijst, filters op drager, decennium, jaar, genre en subgenre.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, LayoutGrid, List, Shuffle } from 'lucide-react'
import { api } from '../api'
import { Laden, Beschikbaarheid } from '../components/Iconen'
import { Hoes } from '../components/Hoes'
import { useKiosk } from './KioskApp'
import { KioskKop } from './Kop'
import { GenreTegels } from './Home'
import { getal, t } from './taal'
import { AanvraagMini, AlbumKaart, type Kaart } from './Kaarten'

type Res = {
  totaal: number; pagina: number; per: number; sort: string; titels: Kaart[]
  facetten: { dragers: { waarde: string; aantal: number }[]; decennia: { waarde: number; aantal: number }[]; jaren: { waarde: number; aantal: number }[]; subfilters: { naam: string; aantal: number }[] }
  knop: { id: number; naam: string; kleur: string } | null
}

export function Zoeken() {
  const [p, setP] = useSearchParams()
  const { config, versie } = useKiosk()
  const [res, setRes] = useState<Res | null>(null)
  const [titels, setTitels] = useState<Kaart[]>([])
  const [laden, setLaden] = useState(true)
  const nav = useNavigate()
  const weergave = p.get('weergave') === 'lijst' ? 'lijst' : 'raster'
  const sleutel = ['q', 'knop', 'sub', 'drager', 'decennium', 'jaar', 'nl', 'beschikbaar', 'sort', 'selectie'].map((k) => `${k}=${p.get(k) ?? ''}`).join('&')

  const zet = (k: string, v?: string | null, wis: string[] = []) => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v); else n.delete(k)
    for (const w of wis) n.delete(w)
    setP(n, { replace: true })
  }

  const laad = (pagina: number) => {
    setLaden(true)
    const q = new URLSearchParams(p)
    q.set('pagina', String(pagina))
    q.delete('weergave'); q.delete('naam')
    return api<Res>(`/kiosk/zoek?${q}`).then((r) => {
      setRes(r)
      setTitels((t) => (pagina === 1 ? r.titels : [...t, ...r.titels]))
    }).finally(() => setLaden(false))
  }
  useEffect(() => { laad(1) }, [sleutel]) // eslint-disable-line react-hooks/exhaustive-deps
  // Beschikbaarheid ververst (andere bezoeker vroeg iets aan): huidige pagina's opnieuw.
  useEffect(() => { if (versie) laad(1) }, [versie]) // eslint-disable-line react-hooks/exhaustive-deps

  const knopId = Number(p.get('knop')) || undefined
  const titel = res?.knop?.naam ?? (p.get('q') ? t('Resultaten voor “{q}”', { q: p.get('q')! }) : p.get('naam') ?? t('Collectie'))
  const verras = async () => {
    try { const r = await api<{ id: number }>(`/kiosk/verras${knopId ? `?knop=${knopId}` : ''}`); nav(`/album/${r.id}`) } catch { /* niets */ }
  }

  return (
    <div className="kiosk-scherm">
      <KioskKop zoekStart={p.get('q') ?? ''} />
      <main className="kiosk-inhoud">
        {knopId && <GenreTegels actief={knopId} />}
        <div className="resultaten-kop" style={{ marginTop: knopId ? 24 : 8 }}>
          <h1>{titel}</h1>
          {res && <span className="muted">{getal(res.totaal)} {res.totaal === 1 ? t('titel') : t('titels')}</span>}
          {knopId && <button className="btn btn-ghost btn-s" style={{ minHeight: 44 }} onClick={verras}><Shuffle size={18} /> {t('Verras me in {naam}', { naam: res?.knop?.naam ?? '' })}</button>}
        </div>

        {res && res.facetten.subfilters.length > 0 && (
          <div className="filters" aria-label={t('Subgenres')}>
            <button className={`chip ${!p.get('sub') ? 'aan' : ''}`} onClick={() => zet('sub', null)}>{t('Alles')}</button>
            {res.facetten.subfilters.map((s) => (
              <button key={s.naam} className={`chip ${p.get('sub') === s.naam ? 'aan' : ''}`} onClick={() => zet('sub', p.get('sub') === s.naam ? null : s.naam)}>
                {s.naam} <span className="n">{s.aantal}</span>
              </button>
            ))}
          </div>
        )}

        <div className="filters">
          {['LP', 'CD'].map((d) => (
            <button key={d} className={`chip ${p.get('drager') === d ? 'aan' : ''}`} onClick={() => zet('drager', p.get('drager') === d ? null : d)} aria-pressed={p.get('drager') === d}>
              {d === 'LP' ? t("Lp's") : t("Cd's")}
            </button>
          ))}
          <button className={`chip ${p.get('beschikbaar') === '1' ? 'aan' : ''}`} onClick={() => zet('beschikbaar', p.get('beschikbaar') === '1' ? null : '1')} aria-pressed={p.get('beschikbaar') === '1'}>{t('Nu beschikbaar')}</button>
          {config.instellingen.nl_weergave === 'schakelaar' && (
            <button className={`chip ${p.get('nl') === '1' ? 'aan' : ''}`} onClick={() => zet('nl', p.get('nl') === '1' ? null : '1')} aria-pressed={p.get('nl') === '1'}>{t('Alleen Nederlands')}</button>
          )}
          <Keuze label={t('Decennium')} waarde={p.get('decennium') ?? ''} onChange={(v) => zet('decennium', v, ['jaar'])}
            opties={(res?.facetten.decennia ?? []).map((d) => ({ waarde: String(d.waarde), label: `${t('Jaren {d}', { d: String(d.waarde).slice(2) })} (${d.aantal})` }))} alle={t('Alle decennia')} />
          {p.get('decennium') && (
            <Keuze label={t('Jaar')} waarde={p.get('jaar') ?? ''} onChange={(v) => zet('jaar', v)}
              opties={(res?.facetten.jaren ?? []).map((d) => ({ waarde: String(d.waarde), label: `${d.waarde} (${d.aantal})` }))} alle={t('Alle jaren')} />
          )}
          <Keuze label={t('Sorteren')} waarde={p.get('sort') ?? ''} onChange={(v) => zet('sort', v)} alle={p.get('q') ? t('Best passend') : t('Artiest')}
            opties={[...(p.get('q') ? [{ waarde: 'artiest', label: t('Artiest') }] : []), { waarde: 'album', label: t('Album') }, { waarde: 'jaar', label: t('Jaar (nieuwste eerst)') }]} />
          <div className="weergave" role="group" aria-label={t('Weergave')}>
            <button className={weergave === 'raster' ? 'aan' : ''} onClick={() => zet('weergave', null)} aria-label={t('Raster')} aria-pressed={weergave === 'raster'}><LayoutGrid size={20} /></button>
            <button className={weergave === 'lijst' ? 'aan' : ''} onClick={() => zet('weergave', 'lijst')} aria-label={t('Lijst')} aria-pressed={weergave === 'lijst'}><List size={20} /></button>
          </div>
        </div>

        {laden && titels.length === 0 && <Laden />}
        {!laden && res && res.totaal === 0 && (
          <div className="leeg">
            <h2>{t('Niets gevonden')}</h2>
            <p>{t('Probeer een andere spelling of minder filters. Of laat je verrassen.')}</p>
            <button className="btn btn-pink" onClick={verras}><Shuffle size={20} /> {t('Verras me')}</button>
          </div>
        )}
        {weergave === 'raster' ? (
          <div className="raster">{titels.map((k) => <AlbumKaart key={k.id} k={k} voet />)}</div>
        ) : (
          <div className="lijst-weergave">
            {titels.map((k) => (
              <div className="lijst-regel" key={k.id}>
                <Hoes src={k.hoes} />
                <button className="tekst" onClick={() => nav(`/album/${k.id}`)}>
                  <div style={{ fontWeight: 600 }}>{k.titel}</div>
                  <div className="muted" style={{ marginTop: 4 }}>{k.artiesten || t('Diverse artiesten')}</div>
                </button>
                <span className="muted">{k.jaar ?? ''}</span>
                <Beschikbaarheid drager={k.drager} beschikbaar={k.beschikbaar} />
                <AanvraagMini k={k} />
              </div>
            ))}
          </div>
        )}
        {res && titels.length < res.totaal && (
          <div className="meer-laden">
            <button className="btn btn-ghost" disabled={laden} onClick={() => laad(res.pagina + 1)}>{laden ? t('Laden…') : t('Meer laden')}</button>
          </div>
        )}
      </main>
    </div>
  )
}

function Keuze({ label, waarde, opties, onChange, alle }: { label: string; waarde: string; opties: { waarde: string; label: string }[]; onChange: (v: string | null) => void; alle: string }) {
  return (
    <label className="select-pill">
      <span className="visually-hidden">{label}</span>
      <select value={waarde} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{alle}</option>
        {opties.map((o) => <option key={o.waarde} value={o.waarde}>{o.label}</option>)}
      </select>
      <ChevronDown size={18} />
    </label>
  )
}
