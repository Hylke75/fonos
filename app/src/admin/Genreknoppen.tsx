// Genreknoppen (10.8): hoofdknoppen, koppeling met Muziekweb-genres, subfilters en "Nederlandse muziek".
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Laden } from '../components/Iconen'
import { Melding, Modal, Toggle } from './ui'

export function Genreknoppen() {
  const [d, setD] = useState<any>(null)
  const [bewerk, setBewerk] = useState<number | null>(null)
  const [m, setM] = useState<any>(null)
  const [nieuw, setNieuw] = useState('')
  const laad = () => api('/beheer/genreknoppen').then(setD)
  useEffect(() => { laad() }, [])
  const patch = async (id: number, body: any) => { try { await api(`/beheer/genreknop/${id}`, { method: 'PATCH', body }); laad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } }
  const verschuif = async (i: number, r: number) => {
    const l = [...d.knoppen]
    const j = i + r
    if (j < 0 || j >= l.length) return
    ;[l[i], l[j]] = [l[j], l[i]]
    for (const [n, k] of l.entries()) if (k.volgorde !== n + 1) await api(`/beheer/genreknop/${k.id}`, { method: 'PATCH', body: { volgorde: n + 1 } })
    laad()
  }
  if (!d) return <Laden />
  return (
    <>
      <h1>Genreknoppen</h1>
      <Melding m={m} />
      <div className="card paneel">
        <h2 style={{ marginTop: 0 }}>"Nederlandse muziek" in de app</h2>
        <p className="muted tekst-klein">Open punt O-7: als gewone knop tussen de genres, of als schakelaar "Alleen Nederlands" bij de resultaten. De definitie staat bij de knop met het vinkje "Nederlands".</p>
        <div style={{ display: 'flex', gap: 10 }}>
          {[['knop', 'Als knop'], ['schakelaar', 'Als schakelaar']].map(([k, l]) => (
            <button key={k} className={`chip ${d.nl_weergave === k ? 'aan' : ''}`} onClick={async () => { await api('/beheer/instellingen', { method: 'PUT', body: { nl_weergave: k } }); laad() }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="tabel-kaart" style={{ background: '#030f1b' }}>
        <table className="btabel">
          <thead><tr><th>Volgorde</th><th>Kleur</th><th>Naam</th><th>Gekoppelde genres</th><th>Actief</th><th /></tr></thead>
          <tbody>
            {d.knoppen.map((k: any, i: number) => (
              <tr key={k.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="menu-knop" aria-label="Omhoog" onClick={() => verschuif(i, -1)} disabled={i === 0}><ArrowUp size={16} /></button>
                  <button className="menu-knop" aria-label="Omlaag" onClick={() => verschuif(i, 1)} disabled={i === d.knoppen.length - 1}><ArrowDown size={16} /></button>
                </td>
                <td><span className="kleurstaal" style={{ display: 'block', background: k.kleur }} /></td>
                <td>{k.naam}{k.nederlands ? <span className="mini-label mw">Nederlands</span> : null}</td>
                <td>{k.koppelingen}</td>
                <td><Toggle aan={!!k.actief} onChange={(v) => patch(k.id, { actief: v })} label="" /></td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-s" onClick={() => setBewerk(k.id)}>Bewerken</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 10, padding: 16, borderTop: '1px solid var(--line)' }}>
          <input className="invoer" value={nieuw} onChange={(e) => setNieuw(e.target.value)} placeholder="Naam nieuwe knop" style={{ maxWidth: 300 }} />
          <button className="btn btn-cyan btn-s" disabled={!nieuw.trim()} onClick={async () => { await api('/beheer/genreknoppen', { body: { naam: nieuw } }); setNieuw(''); laad() }}><Plus size={16} /> Knop toevoegen</button>
        </div>
      </div>
      {bewerk && <KnopBewerken id={bewerk} onSluit={() => { setBewerk(null); laad() }} />}
    </>
  )
}

function KnopBewerken({ id, onSluit }: { id: number; onSluit: () => void }) {
  const [k, setK] = useState<any>(null)
  const [kop, setKop] = useState<any[]>([])
  const [los, setLos] = useState<{ genre: string; aantal: number }[]>([])
  const [alle, setAlle] = useState<string[]>([])
  const [toevoegen, setToevoegen] = useState('')
  const [m, setM] = useState<any>(null)
  const file = useRef<HTMLInputElement>(null)
  const laad = () => api(`/beheer/genreknop/${id}`).then((r) => { setK(r); setKop(r.koppelingen) })
  useEffect(() => {
    laad()
    api('/beheer/datakwaliteit/ongekoppelde_genres').then((r) => setLos(r.rijen))
    api('/beheer/genres').then((g) => setAlle(g.map((x: any) => x.naam)))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!k) return <Modal titel="Genreknop" onSluit={onSluit}><Laden /></Modal>
  const bewaar = async () => {
    setM(null)
    try {
      await api(`/beheer/genreknop/${id}`, { method: 'PATCH', body: { naam: k.naam, kleur: k.kleur, nederlands: !!k.nederlands } })
      await api(`/beheer/genreknop/${id}/koppelingen`, { method: 'PUT', body: { koppelingen: kop } })
      onSluit()
    } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  return (
    <Modal titel={`Genreknop: ${k.naam}`} onSluit={onSluit} breed>
      <Melding m={m} />
      <div className="drie-kol">
        <label className="veld"><span>Naam</span><input value={k.naam} onChange={(e) => setK({ ...k, naam: e.target.value })} /></label>
        <label className="veld"><span>Kleur</span><input type="color" value={k.kleur} onChange={(e) => setK({ ...k, kleur: e.target.value })} style={{ padding: 4, height: 44 }} /></label>
        <div className="veld"><span>Afbeelding</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return
              const fd = new FormData(); fd.append('bestand', f)
              try { const r = await api(`/beheer/genreknop/${id}/afbeelding`, { form: fd }); setK({ ...k, afbeelding: r.afbeelding }) } catch (er) { setM({ soort: 'fout', tekst: (er as ApiFout).message }) }
            }} />
            <button className="btn btn-ghost btn-s" style={{ minHeight: 44 }} onClick={() => file.current?.click()}><Upload size={14} /> Uploaden</button>
            {k.afbeelding && <button className="btn btn-ghost btn-s" style={{ minHeight: 44 }} onClick={async () => { await api(`/beheer/genreknop/${id}`, { method: 'PATCH', body: { afbeelding: null } }); setK({ ...k, afbeelding: null }) }}>Standaard (hoes)</button>}
          </div>
        </div>
      </div>
      <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={!!k.nederlands} onChange={(e) => setK({ ...k, nederlands: e.target.checked })} /> Dit is de definitie van "Nederlandse muziek"</label>
      <h2 style={{ fontSize: 17 }}>Gekoppelde Muziekweb-genres</h2>
      <p className="muted tekst-klein">De weergavenaam is het subfilter in de app. Genres met dezelfde weergavenaam vormen samen één subfilter; zonder weergavenaam geen subfilter.</p>
      <table className="btabel">
        <thead><tr><th>Muziekweb-genre</th><th>Titels</th><th>Weergavenaam (subfilter)</th><th /></tr></thead>
        <tbody>
          {kop.map((g, i) => (
            <tr key={g.mw_genre}>
              <td>{g.mw_genre}</td>
              <td className="dim">{g.titels ?? ''}</td>
              <td><input className="invoer" style={{ minHeight: 36 }} value={g.weergavenaam ?? ''} onChange={(e) => setKop(kop.map((x, n) => (n === i ? { ...x, weergavenaam: e.target.value } : x)))} /></td>
              <td><button className="menu-knop" aria-label="Verwijderen" onClick={() => setKop(kop.filter((_, n) => n !== i))}><Trash2 size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0 20px' }}>
        <input className="invoer" list="genres-knop" value={toevoegen} onChange={(e) => setToevoegen(e.target.value)} placeholder="Muziekweb-genre toevoegen…" style={{ maxWidth: 360 }} />
        <datalist id="genres-knop">{alle.map((g) => <option key={g} value={g} />)}</datalist>
        <button className="btn btn-ghost btn-s" disabled={!toevoegen.trim() || kop.some((x) => x.mw_genre === toevoegen.trim())} onClick={() => { setKop([...kop, { mw_genre: toevoegen.trim(), weergavenaam: toevoegen.trim() }]); setToevoegen('') }}><Plus size={14} /> Toevoegen</button>
      </div>
      {los.length > 0 && (
        <>
          <h2 style={{ fontSize: 17 }}>Nog niet gekoppeld ({los.length})</h2>
          <div className="genre-chips" style={{ marginBottom: 20 }}>
            {los.filter((g) => !kop.some((x) => x.mw_genre === g.genre)).map((g) => (
              <button key={g.genre} className="genre-chip" style={{ border: 0 }} onClick={() => setKop([...kop, { mw_genre: g.genre, weergavenaam: g.genre }])}><Plus size={12} /> {g.genre} <span className="dim">{g.aantal}</span></button>
            ))}
          </div>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn btn-danger" onClick={async () => { if (confirm(`Knop "${k.naam}" verwijderen?`)) { await api(`/beheer/genreknop/${id}`, { method: 'DELETE' }); onSluit() } }}>Knop verwijderen</button>
        <div style={{ display: 'flex', gap: 10 }}><button className="btn btn-ghost" onClick={onSluit}>Annuleren</button><button className="btn btn-cyan" onClick={bewaar}>Opslaan</button></div>
      </div>
    </Modal>
  )
}
