// Statistieken (verbetering 12): gebruik van de Fonotheek over een periode, met export.
// Eén reeks per grafiek (geen legenda nodig), één kleur voor hoeveelheid; waarden staan erbij of in de tooltip.
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../api'
import { Laden } from '../components/Iconen'
import { Hoes } from '../components/Hoes'

type Stat = {
  van: string; tot: string
  kern: { aanvragen: number; dagen: number; min_tot_uitgifte: number | null; platen: number; unieke_titels: number; niet_gevonden: number }
  titels: { id: number; titelnummer: string | null; titel: string; artiesten: string | null; hoes: string | null; aantal: number }[]
  artiesten: { naam: string; aantal: number }[]
  stijlen: { naam: string; aantal: number }[]
  drukte: { dag: number; uur: number; aantal: number }[]
  per_dag: { dag: string; aantal: number }[]
  spelers: { nummer: number; aantal: number }[]
}

const iso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
const dagenTerug = (n: number) => iso(new Date(Date.now() - (n - 1) * 86_400_000))
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
const fmt = (n: number) => n.toLocaleString('nl-NL')

export function Statistieken() {
  const [van, setVan] = useState(dagenTerug(90))
  const [tot, setTot] = useState(iso(new Date()))
  const [d, setD] = useState<Stat | null>(null)
  const [tabel, setTabel] = useState(false)
  useEffect(() => { setD(null); api<Stat>(`/beheer/statistieken?van=${van}&tot=${tot}`).then(setD) }, [van, tot])
  const preset = (n: number) => { setVan(dagenTerug(n)); setTot(iso(new Date())) }
  return (
    <>
      <h1>Statistieken</h1>
      <div className="stat-filters">
        {[[30, '30 dagen'], [90, '90 dagen'], [365, 'Een jaar']].map(([n, l]) => (
          <button key={n} className={`chip ${van === dagenTerug(Number(n)) && tot === iso(new Date()) ? 'aan' : ''}`} onClick={() => preset(Number(n))}>{l}</button>
        ))}
        <label className="veld inline"><span>Van</span><input type="date" value={van} max={tot} onChange={(e) => e.target.value && setVan(e.target.value)} /></label>
        <label className="veld inline"><span>Tot en met</span><input type="date" value={tot} min={van} onChange={(e) => e.target.value && setTot(e.target.value)} /></label>
        <a className="btn btn-ghost btn-s" href={`/api/beheer/statistieken.csv?van=${van}&tot=${tot}`}><Download size={16} /> CSV met alle titels</a>
      </div>
      {!d ? <Laden /> : (
        <>
          <div className="stat-tegels">
            <Tegel w={fmt(d.kern.aanvragen)} l="aanvragen" s={d.kern.dagen ? `${fmt(Math.round(d.kern.aanvragen / d.kern.dagen))} per open dag` : undefined} />
            <Tegel w={fmt(d.kern.platen)} l="platen aangevraagd" s={`${fmt(d.kern.unieke_titels)} verschillende titels`} />
            <Tegel w={d.kern.min_tot_uitgifte != null ? `${d.kern.min_tot_uitgifte} min` : '–'} l="gemiddeld tot uitgifte" />
            <Tegel w={fmt(d.kern.niet_gevonden)} l="niet gevonden in het archief" />
          </div>
          {d.kern.aanvragen === 0 ? <p className="muted">Geen aanvragen in deze periode.</p> : (
            <>
              <div className="card paneel">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <h2 style={{ margin: 0, flex: 1 }}>Aanvragen per dag</h2>
                  <button className="btn btn-ghost btn-s" onClick={() => setTabel(!tabel)} aria-pressed={tabel}>{tabel ? 'Toon grafiek' : 'Toon als tabel'}</button>
                </div>
                {tabel
                  ? <table className="btabel" style={{ marginTop: 12 }}><thead><tr><th>Dag</th><th>Aanvragen</th></tr></thead><tbody>{d.per_dag.map((r) => <tr key={r.dag}><td>{new Date(r.dag).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>{r.aantal}</td></tr>)}</tbody></table>
                  : <PerDag rijen={d.per_dag} van={d.van} tot={d.tot} />}
              </div>
              <div className="stat-twee">
                <div className="card paneel">
                  <h2>Drukte per weekdag en uur</h2>
                  <Drukte cellen={d.drukte} />
                </div>
                <div className="card paneel">
                  <h2>Per platenspeler</h2>
                  <Balken rijen={d.spelers.map((s) => ({ naam: `Speler ${s.nummer}`, aantal: s.aantal }))} />
                </div>
              </div>
              <div className="card paneel">
                <h2>Meest aangevraagd</h2>
                <ol className="stat-top">
                  {d.titels.map((t, i) => (
                    <li key={t.id}>
                      <span className="pos">{i + 1}</span><Hoes src={t.hoes} />
                      <span className="naam"><b>{t.titel}</b><br /><span className="muted" title={t.artiesten ?? ''}>{t.artiesten || 'Diverse artiesten'}</span></span>
                      <span className="aantal">{t.aantal}×</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="stat-twee">
                <div className="card paneel"><h2>Artiesten</h2><Balken rijen={d.artiesten} /></div>
                <div className="card paneel"><h2>Stijlen</h2><Balken rijen={d.stijlen} /></div>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

function Tegel({ w, l, s }: { w: string; l: string; s?: string }) {
  return <div className="card stat-tegel"><div className="w">{w}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</div>
}

/** Horizontale balken, gesorteerd; de waarde staat aan het eind van elke balk. */
function Balken({ rijen }: { rijen: { naam: string; aantal: number }[] }) {
  const max = Math.max(1, ...rijen.map((r) => r.aantal))
  if (!rijen.length) return <p className="muted">Geen gegevens.</p>
  return (
    <div className="balken" role="table">
      {rijen.map((r) => (
        <div key={r.naam} className="balk-rij" role="row" title={`${r.naam}: ${r.aantal}`}>
          <span className="naam" role="cell">{r.naam}</span>
          <span className="spoor" role="cell"><span className="balk" style={{ width: `${(r.aantal / max) * 100}%` }} /></span>
          <span className="w" role="cell">{fmt(r.aantal)}</span>
        </div>
      ))}
    </div>
  )
}

/** Kolommen per dag over de hele periode (ook dagen zonder aanvragen), met tooltip per kolom. */
function PerDag({ rijen, van, tot }: { rijen: { dag: string; aantal: number }[]; van: string; tot: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const per = new Map(rijen.map((r) => [r.dag, r.aantal]))
  const dagen: string[] = []
  for (let t = new Date(`${van}T12:00:00Z`); iso(t) <= tot && dagen.length < 400; t = new Date(t.getTime() + 86_400_000)) dagen.push(iso(t))
  const max = Math.max(1, ...rijen.map((r) => r.aantal))
  const B = 860, H = 180, bw = B / dagen.length
  const stap = Math.ceil(max / 4)
  return (
    <div className="per-dag" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 -12 ${B + 40} ${H + 38}`} role="img" aria-label="Aanvragen per dag">
        {[0, stap, stap * 2, stap * 3, stap * 4].filter((v) => v <= max + stap).map((v) => (
          <g key={v}><line x1={34} x2={B + 40} y1={H - (v / (stap * 4)) * H} y2={H - (v / (stap * 4)) * H} className="raster-lijn" /><text x={28} y={H - (v / (stap * 4)) * H + 4} className="as" textAnchor="end">{v}</text></g>
        ))}
        {dagen.map((dag, i) => {
          const n = per.get(dag) ?? 0
          const h = (n / (stap * 4)) * H
          return (
            <g key={dag} onMouseEnter={() => setHover(i)}>
              <rect x={36 + i * bw} y={0} width={bw} height={H} fill="transparent" />
              {n > 0 && <rect x={36 + i * bw + Math.min(1, bw * 0.15)} y={H - h} width={Math.max(1, bw - Math.min(2, bw * 0.3))} height={h} rx={Math.min(4, bw / 3)} className={`kolom ${hover === i ? 'hover' : ''}`} />}
            </g>
          )
        })}
        <text x={36} y={H + 20} className="as">{new Date(van).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</text>
        <text x={B + 36} y={H + 20} className="as" textAnchor="end">{new Date(tot).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</text>
      </svg>
      {hover != null && (
        <div className="grafiek-tip" style={{ left: `${((36 + (hover + 0.5) * bw) / (B + 40)) * 100}%` }}>
          <b>{per.get(dagen[hover]) ?? 0}</b> aanvragen<br /><span className="muted">{new Date(dagen[hover]).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
      )}
    </div>
  )
}

/** Raster weekdag × uur; donkerder = drukker. Waarde in de tooltip en in de cel. */
function Drukte({ cellen }: { cellen: { dag: number; uur: number; aantal: number }[] }) {
  if (!cellen.length) return <p className="muted">Geen gegevens.</p>
  const uren = cellen.map((c) => c.uur)
  const vanUur = Math.min(...uren), totUur = Math.max(...uren)
  const max = Math.max(1, ...cellen.map((c) => c.aantal))
  const per = new Map(cellen.map((c) => [`${c.dag}-${c.uur}`, c.aantal]))
  const reeks = Array.from({ length: totUur - vanUur + 1 }, (_, i) => vanUur + i)
  return (
    <table className="drukte">
      <thead><tr><th />{reeks.map((u) => <th key={u}>{u}</th>)}</tr></thead>
      <tbody>
        {DAGEN.map((naam, i) => (
          <tr key={naam}>
            <th>{naam}</th>
            {reeks.map((u) => {
              const n = per.get(`${i + 1}-${u}`) ?? 0
              const s = n ? 0.18 + 0.82 * (n / max) : 0
              return <td key={u} title={`${naam} ${u}:00–${u + 1}:00: ${n} aanvragen`} style={{ ['--s' as any]: s, color: s > 0.55 ? '#04122a' : '#fff' }}>{n || ''}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
