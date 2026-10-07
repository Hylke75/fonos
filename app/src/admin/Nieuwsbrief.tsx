// Nieuwsbriefaanmeldingen (11, koppeling "beheer"): bekijken, exporteren als CSV en verwijderen. Alleen beheerders.
import { useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { api, ApiFout, datumTijd as datum } from '../api'
import { Laden } from '../components/Iconen'
import { Melding, ZoekVeld } from './ui'

export function Nieuwsbrief() {
  const [d, setD] = useState<any>(null)
  const [zoek, setZoek] = useState('')
  const [alleenNieuw, setAlleenNieuw] = useState(false)
  const [m, setM] = useState<any>(null)
  const laad = () => api(`/beheer/nieuwsbrief?zoek=${encodeURIComponent(zoek)}&nieuw=${alleenNieuw ? 1 : 0}`).then(setD)
  useEffect(() => { const t = setTimeout(laad, 200); return () => clearTimeout(t) }, [zoek, alleenNieuw]) // eslint-disable-line react-hooks/exhaustive-deps

  const exporteer = async (nieuw: boolean) => {
    setM(null)
    const r = await fetch('/api/beheer/nieuwsbrief/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alleen_nieuw: nieuw }) })
    if (!r.ok) { setM({ soort: 'fout', tekst: 'Exporteren is niet gelukt.' }); return }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'nieuwsbrief-aanmeldingen.csv'
    a.click()
    URL.revokeObjectURL(url)
    setM({ soort: 'ok', tekst: 'Export gedownload. De aanmeldingen zijn gemarkeerd als geëxporteerd.' })
    laad()
  }
  const doe = async (f: () => Promise<any>, ok: string) => { setM(null); try { await f(); setM({ soort: 'ok', tekst: ok }); laad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } }

  if (!d) return <Laden />
  return (
    <>
      <h1>Nieuwsbrief</h1>
      <p className="muted" style={{ marginTop: -8 }}>Aanmeldingen vanaf de kiosk. Exporteer ze naar het nieuwsbriefsysteem van Fonos en verwijder ze daarna hier.</p>
      {d.koppeling !== 'beheer' && <Melding m={{ soort: 'info', tekst: 'Nieuwe aanmeldingen komen hier alleen binnen als bij Instellingen → Nieuwsbriefsysteem "Bewaren in de beheeromgeving" is gekozen.' }} />}
      <Melding m={m} />
      <div className="tellers" style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
        <div className="card teller-blok"><div className="w">{d.totaal}</div><div className="muted tekst-klein">aanmeldingen</div></div>
        <div className={`card teller-blok ${d.nieuw ? 'let-op' : ''}`}><div className="w">{d.nieuw}</div><div className="muted tekst-klein">nog niet geëxporteerd</div></div>
      </div>
      <div className="werkbalk" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <ZoekVeld waarde={zoek} onChange={setZoek} placeholder="Zoek op e-mail of naam" />
        <label className="check"><input type="checkbox" checked={alleenNieuw} onChange={(e) => setAlleenNieuw(e.target.checked)} /> Alleen nog niet geëxporteerd</label>
        <button className="btn btn-cyan" disabled={!d.nieuw} onClick={() => exporteer(true)}><Download size={16} /> Nieuwe exporteren ({d.nieuw})</button>
        <button className="btn btn-ghost" disabled={!d.totaal} onClick={() => exporteer(false)}><Download size={16} /> Alles exporteren</button>
        <button className="btn btn-ghost" disabled={d.totaal === d.nieuw} onClick={() => { if (confirm('Alle geëxporteerde aanmeldingen definitief verwijderen?')) doe(() => api('/beheer/nieuwsbrief/verwijder-geexporteerd', { method: 'POST' }), 'Geëxporteerde aanmeldingen verwijderd.') }}><Trash2 size={16} /> Geëxporteerde verwijderen</button>
      </div>
      <div className="tabel-kaart" style={{ background: '#030f1b' }}>
        <table className="btabel">
          <thead><tr><th>E-mailadres</th><th>Naam</th><th>Aangemeld</th><th>Geëxporteerd</th><th /></tr></thead>
          <tbody>
            {d.aanmeldingen.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>Geen aanmeldingen.</td></tr>}
            {d.aanmeldingen.map((a: any) => (
              <tr key={a.id}>
                <td>{a.email}</td>
                <td>{a.naam ?? <span className="dim">–</span>}</td>
                <td>{datum(a.aangemeld_op)}</td>
                <td>{a.geexporteerd_op ? datum(a.geexporteerd_op) : <span className="mini-label conflict">Nieuw</span>}</td>
                <td style={{ textAlign: 'right' }}><button className="icon-btn" aria-label={`Verwijder ${a.email}`} title="Verwijderen" onClick={() => { if (confirm(`${a.email} verwijderen?`)) doe(() => api(`/beheer/nieuwsbrief/${a.id}`, { method: 'DELETE' }), 'Aanmelding verwijderd.') }}><Trash2 size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.aanmeldingen.length === 500 && <p className="muted tekst-klein">De eerste 500 worden getoond; de export bevat alles.</p>}
    </>
  )
}
