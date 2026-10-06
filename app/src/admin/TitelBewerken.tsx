// Titel bewerken (10.2) en exemplaren (10.3, 10.5).
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, GripVertical, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { api, ApiFout, datumTijd } from '../api'
import { Hoes } from '../components/Hoes'
import { Laden } from '../components/Iconen'
import { TWEELAAGS, REDENEN_AFVOER, VELD_LABEL, type Track } from '../../shared/velden'
import { AlbumWeergave } from '../kiosk/Album'
import { Melding, Modal, Toggle, tekstWaarde } from './ui'

type Detail = any

export function TitelBewerken({ beheerder: _ }: { beheerder: boolean }) {
  const { id } = useParams()
  const [p, setP] = useSearchParams()
  const tab = p.get('tab') ?? 'gegevens'
  const [d, setD] = useState<Detail | null>(null)
  const [m, setM] = useState<any>(null)
  const [genres, setGenres] = useState<string[]>([])
  const nav = useNavigate()
  const laad = () => api(`/beheer/titel/${id}`).then(setD).catch((e: ApiFout) => setM({ soort: 'fout', tekst: e.message }))
  useEffect(() => { laad() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api('/beheer/genres').then((g) => setGenres(g.map((x: any) => x.naam))) }, [])

  const bewaar = async (body: any) => {
    setM(null)
    try { setD(await api(`/beheer/titel/${id}`, { method: 'PATCH', body })); setM({ soort: 'ok', tekst: 'Opgeslagen.' }) } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  const post = async (pad: string, body: any) => {
    setM(null)
    try { setD(await api(`/beheer/titel/${id}/${pad}`, { body })) } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  if (!d) return m ? <Melding m={m} /> : <Laden />

  return (
    <>
      <button className="link-terug" onClick={() => nav(-1)}><ArrowLeft size={18} /> Terug naar de collectie</button>
      <h1 style={{ marginBottom: 6 }}>{d.getoond.titel || '(zonder titel)'}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {(d.getoond.artiesten ?? []).join(', ')} · {d.titelnummer ? <>Titelnummer {d.titelnummer}{!d.in_dump && <span className="mini-label conflict">niet in dump</span>}</> : 'handmatig toegevoegd, zonder titelnummer'} · {d.soort}
      </p>
      <div className="tabs">
        {[['gegevens', 'Gegevens'], ['exemplaren', `Exemplaren (${d.exemplaren.filter((e: any) => e.status === 'in_collectie').length})`], ['voorbeeld', 'Voorbeeld in de app'], ['geschiedenis', 'Geschiedenis']].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'aan' : ''}`} onClick={() => { const n = new URLSearchParams(p); n.set('tab', k); setP(n, { replace: true }) }}>{l}</button>
        ))}
      </div>
      <Melding m={m} />
      {Object.keys(d.conflicten).length > 0 && tab === 'gegevens' && (
        <div className="melding-blok" style={{ background: '#2a1d04', borderColor: '#6b4a0a', color: '#ffd27a' }}>
          Muziekweb heeft {Object.keys(d.conflicten).length === 1 ? 'een veld' : 'velden'} gewijzigd die Fonos had aangepast: {Object.keys(d.conflicten).map((v) => VELD_LABEL[v] ?? v).join(', ')}. Kies per veld welke waarde blijft.
        </div>
      )}

      {tab === 'gegevens' && (
        <div className="twee-kol">
          <div>
            {TWEELAAGS.filter((v) => d.soort === 'klassiek' || !['componisten', 'uitvoerenden'].includes(v.veld)).map((v) => (
              <VeldBewerker key={v.veld} def={v} d={d} genres={genres}
                opslaan={(w) => bewaar({ velden: { [v.veld]: w } })}
                terug={() => post('terug', { veld: v.veld })}
                besluit={(k) => post('conflict', { veld: v.veld, keuze: k })}
                upload={async (f) => {
                  const fd = new FormData(); fd.append('bestand', f)
                  try { setD(await api(`/beheer/titel/${id}/hoes/${v.veld === 'hoes_achter' ? 'achter' : 'voor'}`, { form: fd })) } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
                }} />
            ))}
          </div>
          <div>
            <div className="card paneel">
              <h2 style={{ marginTop: 0 }}>In de bezoekersapp</h2>
              <Toggle aan={d.zichtbaar} onChange={(v) => bewaar({ eigen: { zichtbaar: v } })} label="Zichtbaar in app" />
              <br />
              <Toggle aan={d.uitgelicht} onChange={(v) => bewaar({ eigen: { uitgelicht: v } })} label="Uitgelicht door Fonos" />
              <br />
              <Toggle aan={d.ai_tekst} onChange={(v) => bewaar({ eigen: { ai_tekst: v } })} label="Toelichting gegenereerd met AI" />
              <p className="dim tekst-klein">Een titel is zichtbaar als dit aan staat én er minstens één exemplaar in de collectie is.</p>
            </div>
            <FonosVerhaal waarde={d.fonos_verhaal} opslaan={(w) => bewaar({ eigen: { fonos_verhaal: w } })} />
            {!d.titelnummer && <KoppelTitelnummer koppel={(tn) => post('koppel', { titelnummer: tn })} />}
            <div className="card paneel tekst-klein muted">
              Toegevoegd {datumTijd(d.aangemaakt)}<br />Laatst gewijzigd {datumTijd(d.gewijzigd)}
              {d.titelnummer && <><br /><a href={`https://www.muziekweb.nl/Link/${d.titelnummer}`} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>Bekijk op Muziekweb</a></>}
            </div>
          </div>
        </div>
      )}
      {tab === 'exemplaren' && <Exemplaren d={d} herlaad={laad} />}
      {tab === 'voorbeeld' && <Voorbeeld id={d.id} />}
      {tab === 'geschiedenis' && <Geschiedenis regels={d.geschiedenis} herlaad={laad} />}
    </>
  )
}

function VeldBewerker({ def, d, genres, opslaan, terug, besluit, upload }: {
  def: (typeof TWEELAAGS)[number]; d: Detail; genres: string[]
  opslaan: (w: unknown) => void; terug: () => void; besluit: (k: 'fonos' | 'muziekweb') => void; upload: (f: File) => void
}) {
  const veld = def.veld
  const getoond = d.getoond[veld]
  const heeftFonos = veld in d.fonos
  const conflict = d.conflicten[veld]
  const naarInvoer = (v: any) => (def.soort === 'lijst' ? (v ?? []).join(', ') : v ?? '')
  const [w, setW] = useState<any>(naarInvoer(getoond))
  useEffect(() => setW(naarInvoer(getoond)), [JSON.stringify(getoond)]) // eslint-disable-line react-hooks/exhaustive-deps
  const naarWaarde = (v: any) => {
    if (def.soort === 'lijst') return String(v).split(',').map((x) => x.trim()).filter(Boolean)
    if (def.soort === 'getal') return v === '' ? null : Number(v)
    if (def.soort === 'tekst' || def.soort === 'lang' || def.soort === 'drager') return v === '' ? null : v
    return v
  }
  const gewijzigd = JSON.stringify(naarWaarde(w) ?? null) !== JSON.stringify(getoond ?? null) && !['tracks', 'genres', 'hoes'].includes(def.soort)
  const file = useRef<HTMLInputElement>(null)

  return (
    <div className={`veld-twee ${conflict ? 'conflict' : ''}`}>
      <div className="kop">
        <span>{def.label}</span>
        {heeftFonos && <span className="mini-label fonos">aangepast door Fonos</span>}
        {conflict && <span className="mini-label conflict">conflict</span>}
        <span className="acties">
          {gewijzigd && <><button className="btn btn-ghost btn-s" onClick={() => setW(naarInvoer(getoond))}>Herstel</button><button className="btn btn-cyan btn-s" onClick={() => opslaan(naarWaarde(w))}>Opslaan</button></>}
          {heeftFonos && d.titelnummer && !gewijzigd && <button className="btn btn-ghost btn-s" onClick={terug} title="Fonos-waarde wissen"><RotateCcw size={14} /> Terug naar Muziekweb</button>}
        </span>
      </div>
      {def.soort === 'tekst' && <input className="invoer" value={w} onChange={(e) => setW(e.target.value)} />}
      {def.soort === 'lijst' && <input className="invoer" value={w} onChange={(e) => setW(e.target.value)} placeholder="Gescheiden door komma's" />}
      {def.soort === 'getal' && <input className="invoer" type="number" min={1} value={w} onChange={(e) => setW(e.target.value)} style={{ maxWidth: 140 }} />}
      {def.soort === 'lang' && <textarea className="invoer" value={w} onChange={(e) => setW(e.target.value)} rows={6} style={{ minHeight: 140 }} />}
      {def.soort === 'drager' && (
        <select className="invoer" value={w} onChange={(e) => setW(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">—</option><option>LP</option><option>CD</option><option>Overig</option>
        </select>
      )}
      {def.soort === 'genres' && <GenresBewerker waarde={getoond ?? []} alle={genres} opslaan={opslaan} />}
      {def.soort === 'tracks' && <TracksBewerker waarde={getoond ?? []} opslaan={opslaan} />}
      {def.soort === 'hoes' && (
        <div className="hoes-bewerk">
          <Hoes src={getoond} />
          <div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button className="btn btn-ghost btn-s" onClick={() => file.current?.click()}><Upload size={14} /> Eigen afbeelding uploaden</button>
            <div className="dim tekst-klein" style={{ marginTop: 6 }}>jpg, png of webp, maximaal 10 MB. Vervangt de Muziekweb-hoes.</div>
          </div>
        </div>
      )}
      {heeftFonos && d.titelnummer && !['hoes'].includes(def.soort) && (
        <div className="mw-waarde">Muziekweb: {tekstWaarde(d.mw[veld])}</div>
      )}
      {conflict && (
        <div className="conflict-blok">
          Muziekweb wijzigde dit veld na de aanpassing door Fonos.<br />
          Oude Muziekweb-waarde: {tekstWaarde(conflict.mw_oud)}<br />
          Nieuwe Muziekweb-waarde: {tekstWaarde(conflict.mw_nieuw)}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-ghost btn-s" onClick={() => besluit('fonos')}>Fonos-waarde houden</button>
            <button className="btn btn-ghost btn-s" onClick={() => besluit('muziekweb')}>Nieuwe Muziekweb-waarde nemen</button>
          </div>
        </div>
      )}
    </div>
  )
}

function GenresBewerker({ waarde, alle, opslaan }: { waarde: string[]; alle: string[]; opslaan: (w: string[]) => void }) {
  const [kies, setKies] = useState('')
  return (
    <>
      <div className="genre-chips">
        {waarde.map((g) => <span key={g} className="genre-chip">{g}<button aria-label={`Verwijder ${g}`} onClick={() => opslaan(waarde.filter((x) => x !== g))}><X size={14} /></button></span>)}
        {waarde.length === 0 && <span className="dim tekst-klein">Geen genres</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="invoer" list="alle-genres" value={kies} onChange={(e) => setKies(e.target.value)} placeholder="Genre toevoegen…" style={{ maxWidth: 320 }} />
        <datalist id="alle-genres">{alle.map((g) => <option key={g} value={g} />)}</datalist>
        <button className="btn btn-ghost btn-s" disabled={!kies.trim() || waarde.includes(kies.trim())} onClick={() => { opslaan([...waarde, kies.trim()]); setKies('') }}><Plus size={14} /> Toevoegen</button>
      </div>
    </>
  )
}

function TracksBewerker({ waarde, opslaan }: { waarde: Track[]; opslaan: (w: Track[]) => void }) {
  const [t, setT] = useState<Track[]>(waarde)
  const [sleep, setSleep] = useState<number | null>(null)
  useEffect(() => setT(waarde), [JSON.stringify(waarde)]) // eslint-disable-line react-hooks/exhaustive-deps
  const gewijzigd = JSON.stringify(t) !== JSON.stringify(waarde)
  const zet = (i: number, k: keyof Track, v: any) => setT(t.map((x, n) => (n === i ? { ...x, [k]: v } : x)))
  const hernummer = (l: Track[]) => l.map((x, i) => ({ ...x, pos: i + 1 }))
  return (
    <>
      {t.map((tr, i) => (
        <div key={i} className={`track-regel ${sleep === i ? 'sleep' : ''}`} draggable onDragStart={() => setSleep(i)} onDragEnd={() => setSleep(null)}
          onDragOver={(e) => { e.preventDefault(); if (sleep == null || sleep === i) return; const l = [...t]; const [x] = l.splice(sleep, 1); l.splice(i, 0, x); setT(hernummer(l)); setSleep(i) }}>
          <span className="greep" aria-hidden="true"><GripVertical size={16} /></span>
          <input className="invoer" value={tr.pos} onChange={(e) => zet(i, 'pos', Number(e.target.value) || 0)} aria-label="Positie" />
          <input className="invoer" value={tr.titel} onChange={(e) => zet(i, 'titel', e.target.value)} aria-label="Titel" />
          <input className="invoer" value={tr.duur ?? ''} onChange={(e) => zet(i, 'duur', e.target.value || null)} aria-label="Duur" placeholder="m:ss" />
          <button className="menu-knop" aria-label="Regel verwijderen" onClick={() => setT(hernummer(t.filter((_, n) => n !== i)))}><Trash2 size={16} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-ghost btn-s" onClick={() => setT([...t, { pos: t.length + 1, titel: '', duur: null }])}><Plus size={14} /> Regel toevoegen</button>
        {gewijzigd && <><button className="btn btn-ghost btn-s" onClick={() => setT(waarde)}>Herstel</button><button className="btn btn-cyan btn-s" onClick={() => opslaan(t.filter((x) => x.titel.trim()))}>Tracklist opslaan</button></>}
      </div>
    </>
  )
}

function FonosVerhaal({ waarde, opslaan }: { waarde: string | null; opslaan: (w: string) => void }) {
  const [w, setW] = useState(waarde ?? '')
  useEffect(() => setW(waarde ?? ''), [waarde])
  return (
    <div className="card paneel">
      <h2 style={{ marginTop: 0 }}>Fonos-verhaal</h2>
      <textarea className="invoer" rows={6} value={w} onChange={(e) => setW(e.target.value)} placeholder="Eigen tekst van Fonos, los van de Muziekweb-toelichting" style={{ minHeight: 140 }} />
      {w !== (waarde ?? '') && <button className="btn btn-cyan btn-s" style={{ marginTop: 10 }} onClick={() => opslaan(w)}>Opslaan</button>}
    </div>
  )
}

function KoppelTitelnummer({ koppel }: { koppel: (tn: string) => void }) {
  const [tn, setTn] = useState('')
  return (
    <div className="card paneel">
      <h2 style={{ marginTop: 0 }}>Koppelen aan Muziekweb</h2>
      <p className="muted tekst-klein">De ingevulde waarden blijven staan als Fonos-waarden; de Muziekweb-waarden worden aangevuld.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="invoer" value={tn} onChange={(e) => setTn(e.target.value.toUpperCase())} placeholder="Titelnummer" />
        <button className="btn btn-ghost btn-s" disabled={!tn.trim()} onClick={() => koppel(tn.trim())}>Koppel</button>
      </div>
    </div>
  )
}

function Exemplaren({ d, herlaad }: { d: Detail; herlaad: () => void }) {
  const [m, setM] = useState<any>(null)
  const [obj, setObj] = useState('')
  const [vind, setVind] = useState('')
  const [afvoer, setAfvoer] = useState<any>(null)
  const [bewerk, setBewerk] = useState<any>(null)
  const doe = async (f: () => Promise<any>, ok: string) => {
    setM(null)
    try { await f(); setM({ soort: 'ok', tekst: ok }); herlaad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  return (
    <>
      <Melding m={m} />
      <div className="tabel-kaart" style={{ background: '#030f1b', marginBottom: 20 }}>
        <table className="btabel">
          <thead><tr><th>Objectnummer</th><th>Vindcode</th><th>Status</th><th>Bron</th><th /></tr></thead>
          <tbody>
            {d.exemplaren.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 24 }}>Nog geen exemplaren.</td></tr>}
            {d.exemplaren.map((e: any) => (
              <tr key={e.id}>
                <td>{e.objectnummer}</td>
                <td>{e.vindcode_getoond ?? '—'}</td>
                <td>
                  {e.status === 'in_collectie' ? <span className="status status-actief">In collectie</span> : <span className="status status-verborgen">Uit collectie</span>}
                  {e.in_gebruik ? <span className="mini-label conflict">in gebruik</span> : null}
                  {e.reden_afvoer && <div className="dim tekst-klein">{REDENEN_AFVOER[e.reden_afvoer]}{e.toelichting_afvoer ? `: ${e.toelichting_afvoer}` : ''}</div>}
                </td>
                <td className="dim tekst-klein">{e.bron}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-s" onClick={() => setBewerk({ ...e, titelnummer_nieuw: '' })}>Bewerken</button>{' '}
                  {e.status === 'in_collectie'
                    ? <button className="btn btn-danger btn-s" disabled={!!e.in_gebruik} title={e.in_gebruik ? 'Zit in een open aanvraag' : ''} onClick={() => setAfvoer({ id: e.id, reden: 'beschadigd', toelichting: '' })}>Afvoeren</button>
                    : <button className="btn btn-ghost btn-s" onClick={() => doe(() => api(`/beheer/exemplaar/${e.id}/terugzetten`, { method: 'POST' }), 'Exemplaar staat weer in de collectie.')}>Afvoeren terugdraaien</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card paneel">
        <h2 style={{ marginTop: 0 }}>Exemplaar toevoegen</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="veld" style={{ marginBottom: 0 }}><span>Objectnummer</span><input value={obj} onChange={(e) => setObj(e.target.value.trim())} inputMode="numeric" /></label>
          <label className="veld" style={{ marginBottom: 0 }}><span>Vindcode</span><input value={vind} onChange={(e) => setVind(e.target.value)} /></label>
          <button className="btn btn-cyan" style={{ height: 44 }} disabled={!obj} onClick={() => doe(() => api('/beheer/exemplaren', { body: { titel_id: d.id, objectnummer: obj, vindcode: vind } }).then(() => { setObj(''); setVind('') }), 'Exemplaar toegevoegd.')}><Plus size={18} /> Toevoegen</button>
        </div>
      </div>
      {afvoer && (
        <Modal titel="Exemplaar afvoeren" onSluit={() => setAfvoer(null)}>
          <p className="muted">Het exemplaar wordt niet verwijderd, maar krijgt de status "uit collectie". Dit is terug te draaien.</p>
          <label className="veld"><span>Reden</span><select value={afvoer.reden} onChange={(e) => setAfvoer({ ...afvoer, reden: e.target.value })}>{Object.entries(REDENEN_AFVOER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="veld"><span>Toelichting{afvoer.reden === 'overig' ? ' (verplicht)' : ''}</span><input value={afvoer.toelichting} onChange={(e) => setAfvoer({ ...afvoer, toelichting: e.target.value })} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setAfvoer(null)}>Annuleren</button>
            <button className="btn btn-pink" disabled={afvoer.reden === 'overig' && !afvoer.toelichting.trim()} onClick={() => { const a = afvoer; setAfvoer(null); doe(() => api(`/beheer/exemplaar/${a.id}/afvoeren`, { body: a }), 'Exemplaar afgevoerd.') }}>Afvoeren</button>
          </div>
        </Modal>
      )}
      {bewerk && (
        <Modal titel={`Exemplaar ${bewerk.objectnummer}`} onSluit={() => setBewerk(null)}>
          <label className="veld"><span>Objectnummer</span><input value={bewerk.objectnummer} onChange={(e) => setBewerk({ ...bewerk, objectnummer: e.target.value })} /></label>
          <label className="veld"><span>Vindcode</span><input value={bewerk.vindcode ?? ''} onChange={(e) => setBewerk({ ...bewerk, vindcode: e.target.value })} /></label>
          <label className="veld"><span>Koppelen aan een andere titel (correctie): titelnummer</span><input value={bewerk.titelnummer_nieuw} onChange={(e) => setBewerk({ ...bewerk, titelnummer_nieuw: e.target.value.toUpperCase() })} placeholder="Leeg laten om de koppeling te houden" /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setBewerk(null)}>Annuleren</button>
            <button className="btn btn-cyan" onClick={() => {
              const b = bewerk; setBewerk(null)
              doe(() => api(`/beheer/exemplaar/${b.id}`, { method: 'PATCH', body: { objectnummer: b.objectnummer, vindcode: b.vindcode, ...(b.titelnummer_nieuw.trim() ? { titelnummer: b.titelnummer_nieuw.trim() } : {}) } }), 'Exemplaar opgeslagen.')
            }}>Opslaan</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Voorbeeld({ id }: { id: number }) {
  const [a, setA] = useState<any>(null)
  useEffect(() => { api(`/beheer/titel/${id}/voorbeeld`).then(setA) }, [id])
  if (!a) return <Laden />
  return (
    <div className="card" style={{ padding: 32, background: 'var(--bg)' }}>
      <p className="dim tekst-klein" style={{ marginTop: 0 }}>Zo ziet de albumpagina eruit in de bezoekersapp{a.beschikbaar ? '' : ' (nu niet zichtbaar of niet beschikbaar)'}.</p>
      <AlbumWeergave a={a} voorbeeld />
    </div>
  )
}

export function Geschiedenis({ regels, herlaad }: { regels: any[]; herlaad: () => void }) {
  const [m, setM] = useState<any>(null)
  return (
    <>
      <Melding m={m} />
      <LogTabel regels={regels} terugzetten={async (id) => {
        try { await api(`/beheer/log/${id}/terugzetten`, { method: 'POST' }); setM({ soort: 'ok', tekst: 'Oude waarde teruggezet.' }); herlaad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
      }} />
    </>
  )
}

export function LogTabel({ regels, terugzetten, toonRecord = false }: { regels: any[]; terugzetten: (id: number) => void; toonRecord?: boolean }) {
  const nav = useNavigate()
  const kort = (s: string | null) => {
    if (s == null) return '—'
    let v: any = s
    try { v = JSON.parse(s) } catch { /* tekst */ }
    const t = tekstWaarde(v)
    return t.length > 160 ? t.slice(0, 160) + '…' : t
  }
  return (
    <div className="tabel-kaart" style={{ background: '#030f1b' }}>
      <table className="btabel">
        <thead><tr><th>Wanneer</th><th>Wie</th><th>Actie</th>{toonRecord && <th>Record</th>}<th>Veld</th><th>Oud</th><th>Nieuw</th><th /></tr></thead>
        <tbody>
          {regels.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 24 }}>Nog geen wijzigingen.</td></tr>}
          {regels.map((l) => (
            <tr key={l.id}>
              <td className="tekst-klein" style={{ whiteSpace: 'nowrap' }}>{datumTijd(l.tijd)}</td>
              <td className="tekst-klein">{l.gebruiker}</td>
              <td className="tekst-klein">{l.actie}</td>
              {toonRecord && <td className="tekst-klein">{l.record_type === 'titel' ? <button className="link-terug" style={{ minHeight: 0, color: 'var(--cyan)', padding: 0 }} onClick={() => nav(`/beheer/titel/${l.record_id}?tab=geschiedenis`)}>{l.record_label ?? `titel ${l.record_id}`}</button> : `${l.record_type ?? ''} ${l.record_label ?? l.record_id ?? ''}`}</td>}
              <td className="tekst-klein">{l.veld ? VELD_LABEL[l.veld] ?? l.veld : ''}</td>
              <td className="tekst-klein dim" style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{kort(l.oud)}</td>
              <td className="tekst-klein" style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{kort(l.nieuw)}</td>
              <td>{['veld gewijzigd', 'terug naar Muziekweb'].includes(l.actie) && ['titel', 'exemplaar'].includes(l.record_type) && <button className="btn btn-ghost btn-s" onClick={() => terugzetten(l.id)}><RotateCcw size={14} /> Oude waarde</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
