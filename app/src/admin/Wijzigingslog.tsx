// Wijzigingslog (10.12): doorzoekbaar en filterbaar; oude waarde terugzetten.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiFout } from '../api'
import { Laden } from '../components/Iconen'
import { LogTabel } from './TitelBewerken'
import { Melding, SelectBlok, ZoekVeld } from './ui'

export function Wijzigingslog() {
  const [p, setP] = useSearchParams()
  const [d, setD] = useState<any>(null)
  const [m, setM] = useState<any>(null)
  const q = p.toString()
  const zet = (k: string, v: string) => { const n = new URLSearchParams(p); v ? n.set(k, v) : n.delete(k); n.delete('pagina'); setP(n, { replace: true }) }
  const laad = () => api(`/beheer/log?${q}`).then(setD)
  useEffect(() => { laad() }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const pagina = Number(p.get('pagina') ?? 1)
  return (
    <>
      <h1>Wijzigingslog</h1>
      <div className="werkbalk">
        <ZoekVeld waarde={p.get('q') ?? ''} onChange={(v) => zet('q', v)} placeholder="Zoek op record, actie, veld of waarde…" />
        <SelectBlok label="Gebruiker" waarde={p.get('gebruiker') ?? ''} onChange={(v) => zet('gebruiker', v)} opties={[{ waarde: '', label: 'Alle gebruikers' }, ...(d?.gebruikers ?? []).map((g: string) => ({ waarde: g, label: g }))]} />
        <SelectBlok label="Soort record" waarde={p.get('type') ?? ''} onChange={(v) => zet('type', v)} opties={[['', 'Alle records'], ['titel', 'Titels'], ['exemplaar', 'Exemplaren'], ['aanvraag', 'Aanvragen'], ['import', 'Imports'], ['backup', 'Back-ups'], ['genreknop', 'Genreknoppen'], ['selectie', 'Selecties'], ['instelling', 'Instellingen'], ['gebruiker', 'Gebruikers'], ['platenspeler', 'Platenspelers']].map(([w, l]) => ({ waarde: w, label: l }))} />
        <label className="veld" style={{ marginBottom: 0 }}><span className="visually-hidden">Vanaf</span><input type="date" value={p.get('van') ?? ''} onChange={(e) => zet('van', e.target.value)} style={{ height: 50 }} /></label>
        <label className="veld" style={{ marginBottom: 0 }}><span className="visually-hidden">Tot en met</span><input type="date" value={p.get('tot') ?? ''} onChange={(e) => zet('tot', e.target.value)} style={{ height: 50 }} /></label>
      </div>
      <Melding m={m} />
      {!d ? <Laden /> : <>
        <LogTabel regels={d.regels} toonRecord terugzetten={async (id) => {
          try { await api(`/beheer/log/${id}/terugzetten`, { method: 'POST' }); setM({ soort: 'ok', tekst: 'Oude waarde teruggezet.' }); laad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
        }} />
        {d.totaal > 100 && (
          <div className="paginering">
            {d.totaal.toLocaleString('nl-NL')} regels
            <button className="btn btn-ghost btn-s" disabled={pagina <= 1} onClick={() => { const n = new URLSearchParams(p); n.set('pagina', String(pagina - 1)); setP(n) }}>Vorige</button>
            <button className="btn btn-ghost btn-s" disabled={pagina * 100 >= d.totaal} onClick={() => { const n = new URLSearchParams(p); n.set('pagina', String(pagina + 1)); setP(n) }}>Volgende</button>
          </div>
        )}
      </>}
    </>
  )
}
