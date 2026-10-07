// Selecties voor de homepagina (10.9).
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Hoes } from '../components/Hoes'
import { Laden } from '../components/Iconen'
import { Melding, Modal, Toggle, ZoekVeld } from './ui'

const SOORT: Record<string, string> = { uitgelicht: 'Automatisch: veld "uitgelicht"', nieuw: 'Automatisch: nieuw in de collectie', vaak: 'Automatisch: vaak aangevraagd', handmatig: 'Handmatig', seizoen: 'Seizoen (handmatig en/of genre)' }

export function Selecties() {
  const [l, setL] = useState<any[] | null>(null)
  const [bewerk, setBewerk] = useState<number | null>(null)
  const [nieuw, setNieuw] = useState({ naam: '', soort: 'handmatig' })
  const laad = () => api('/beheer/selecties').then(setL)
  useEffect(() => { laad() }, [])
  const verschuif = async (i: number, r: number) => {
    const n = [...l!]; const j = i + r
    if (j < 0 || j >= n.length) return
    ;[n[i], n[j]] = [n[j], n[i]]
    for (const [k, s] of n.entries()) if (s.volgorde !== k + 1) await api(`/beheer/selectie/${s.id}`, { method: 'PATCH', body: { volgorde: k + 1 } })
    laad()
  }
  if (!l) return <Laden />
  return (
    <>
      <h1>Selecties</h1>
      <p className="muted" style={{ marginTop: -10 }}>De rijen met hoezen op de homepagina, in deze volgorde. Lege rijen worden niet getoond; seizoensselecties alleen in hun periode.</p>
      <div className="tabel-kaart" style={{ background: '#030f1b' }}>
        <table className="btabel">
          <thead><tr><th>Volgorde</th><th>Naam</th><th>Soort</th><th>Periode</th><th>Actief</th><th /></tr></thead>
          <tbody>
            {l.map((s, i) => (
              <tr key={s.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="menu-knop" aria-label="Omhoog" disabled={i === 0} onClick={() => verschuif(i, -1)}><ArrowUp size={16} /></button>
                  <button className="menu-knop" aria-label="Omlaag" disabled={i === l.length - 1} onClick={() => verschuif(i, 1)}><ArrowDown size={16} /></button>
                </td>
                <td>{s.naam}</td>
                <td className="tekst-klein muted">{SOORT[s.soort]}{s.handmatig ? ` · ${s.handmatig} titels` : ''}</td>
                <td className="tekst-klein">{s.soort === 'seizoen' ? `${s.begin ?? '?'} t/m ${s.eind ?? '?'}` : ''}</td>
                <td><Toggle aan={!!s.actief} onChange={async (v) => { await api(`/beheer/selectie/${s.id}`, { method: 'PATCH', body: { actief: v } }); laad() }} label="" /></td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-s" onClick={() => setBewerk(s.id)}>Bewerken</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 10, padding: 16, borderTop: '1px solid var(--line)' }}>
          <input className="invoer" value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} placeholder="Naam nieuwe selectie" style={{ maxWidth: 300 }} />
          <select className="invoer" value={nieuw.soort} onChange={(e) => setNieuw({ ...nieuw, soort: e.target.value })} style={{ maxWidth: 200 }}><option value="handmatig">Handmatig</option><option value="seizoen">Seizoen</option></select>
          <button className="btn btn-cyan btn-s" disabled={!nieuw.naam.trim()} onClick={async () => { const r = await api('/beheer/selecties', { body: nieuw }); setNieuw({ naam: '', soort: 'handmatig' }); laad(); setBewerk(r.id) }}><Plus size={16} /> Toevoegen</button>
        </div>
      </div>
      {bewerk && <SelectieBewerken id={bewerk} onSluit={() => { setBewerk(null); laad() }} />}
    </>
  )
}

function SelectieBewerken({ id, onSluit }: { id: number; onSluit: () => void }) {
  const [s, setS] = useState<any>(null)
  const [titels, setTitels] = useState<any[]>([])
  const [zoek, setZoek] = useState('')
  const [res, setRes] = useState<any[]>([])
  const [sleep, setSleep] = useState<number | null>(null)
  const [m, setM] = useState<any>(null)
  useEffect(() => { api(`/beheer/selectie/${id}`).then((r) => { setS(r); setTitels(r.titels) }) }, [id])
  useEffect(() => { if (zoek.length < 2) { setRes([]); return } api(`/beheer/titels?q=${encodeURIComponent(zoek)}&per=12&zichtbaar=ja`).then((r) => setRes(r.titels)) }, [zoek])
  if (!s) return <Modal titel="Selectie" onSluit={onSluit}><Laden /></Modal>
  const handmatig = ['handmatig', 'seizoen'].includes(s.soort)
  const bewaar = async () => {
    try {
      await api(`/beheer/selectie/${id}`, { method: 'PATCH', body: { naam: s.naam, begin: s.begin, eind: s.eind, aantal: Number(s.aantal), periode_dagen: Number(s.periode_dagen), mw_genre: s.mw_genre } })
      if (handmatig) await api(`/beheer/selectie/${id}/titels`, { method: 'PUT', body: { ids: titels.map((t) => t.id) } })
      onSluit()
    } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  return (
    <Modal titel={`Selectie: ${s.naam}`} onSluit={onSluit} breed>
      <Melding m={m} />
      <div className="drie-kol">
        <label className="veld"><span>Naam</span><input value={s.naam} onChange={(e) => setS({ ...s, naam: e.target.value })} /></label>
        <label className="veld"><span>Aantal titels in de rij</span><input type="number" min={1} max={60} value={s.aantal} onChange={(e) => setS({ ...s, aantal: e.target.value })} /></label>
        {s.soort === 'vaak' && <label className="veld"><span>Periode (dagen)</span><input type="number" min={1} value={s.periode_dagen} onChange={(e) => setS({ ...s, periode_dagen: e.target.value })} /></label>}
        {s.soort === 'seizoen' && <>
          <label className="veld"><span>Begin (MM-DD)</span><input value={s.begin ?? ''} onChange={(e) => setS({ ...s, begin: e.target.value })} placeholder="12-01" /></label>
          <label className="veld"><span>Eind (MM-DD)</span><input value={s.eind ?? ''} onChange={(e) => setS({ ...s, eind: e.target.value })} placeholder="12-31" /></label>
          <label className="veld"><span>Aanvullen met Muziekweb-genre (optioneel)</span><input value={s.mw_genre ?? ''} onChange={(e) => setS({ ...s, mw_genre: e.target.value })} placeholder="bijv. Kerst" /></label>
        </>}
      </div>
      <p className="muted tekst-klein">{SOORT[s.soort]}.{s.soort === 'uitgelicht' ? ' Vink "Uitgelicht door Fonos" aan bij een titel om hem hier te tonen.' : ''}</p>
      {handmatig && (
        <>
          <h2 style={{ fontSize: 17 }}>Titels ({titels.length}) – sleep om de volgorde te wijzigen</h2>
          {titels.map((t, i) => (
            <div key={t.id} className={`track-regel ${sleep === i ? 'sleep' : ''}`} style={{ gridTemplateColumns: '28px 46px 1fr 40px' }} draggable onDragStart={() => setSleep(i)} onDragEnd={() => setSleep(null)}
              onDragOver={(e) => { e.preventDefault(); if (sleep == null || sleep === i) return; const l = [...titels]; const [x] = l.splice(sleep, 1); l.splice(i, 0, x); setTitels(l); setSleep(i) }}>
              <span className="greep"><GripVertical size={16} /></span><Hoes src={t.hoes} /><span>{t.titel} <span className="muted">· {t.artiesten}</span></span>
              <button className="menu-knop" aria-label="Verwijderen" onClick={() => setTitels(titels.filter((x) => x.id !== t.id))}><Trash2 size={16} /></button>
            </div>
          ))}
          <div style={{ marginTop: 12 }}><ZoekVeld waarde={zoek} onChange={setZoek} placeholder="Titel zoeken om toe te voegen…" /></div>
          {res.map((t) => (
            <div key={t.id} className="track-regel" style={{ gridTemplateColumns: '46px 1fr 120px', marginTop: 6 }}>
              <Hoes src={t.hoes} /><span>{t.titel} <span className="muted">· {t.artiesten}</span></span>
              <button className="btn btn-ghost btn-s" disabled={titels.some((x) => x.id === t.id)} onClick={() => setTitels([...titels, t])}><Plus size={14} /> Voeg toe</button>
            </div>
          ))}
        </>
      )}
      {s.voorbeeld?.length > 0 && (
        <>
          <h2 style={{ fontSize: 17 }}>Voorbeeld (automatisch)</h2>
          <div className="genre-chips">{s.voorbeeld.slice(0, 30).map((t: any) => <span key={t.id} className="genre-chip">{t.titel}</span>)}</div>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        {handmatig ? <button className="btn btn-danger" onClick={async () => { if (confirm('Selectie verwijderen?')) { await api(`/beheer/selectie/${id}`, { method: 'DELETE' }); onSluit() } }}>Verwijderen</button> : <span />}
        <div style={{ display: 'flex', gap: 10 }}><button className="btn btn-ghost" onClick={onSluit}>Annuleren</button><button className="btn btn-cyan" onClick={bewaar}>Opslaan</button></div>
      </div>
    </Modal>
  )
}
