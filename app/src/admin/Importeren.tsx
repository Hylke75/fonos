// Importeren: bulkimport collectie (10.6), Muziekweb-import en datakwaliteit (10.7).
import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { api, ApiFout, datumTijd } from '../api'
import { Laden } from '../components/Iconen'
import { Melding } from './ui'
import { uploadBestand } from './upload'

export function Importeren({ beheerder }: { beheerder: boolean }) {
  const [p, setP] = useSearchParams()
  const tab = p.get('tab') ?? 'collectie'
  const tabs = [['collectie', 'Collectie (bulk)'], ...(beheerder ? [['muziekweb', 'Muziekweb-import']] : []), ['datakwaliteit', 'Datakwaliteit'], ['historie', 'Historie']]
  return (
    <>
      <h1>Importeren</h1>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'aan' : ''}`} onClick={() => setP({ tab: k })}>{l}</button>)}</div>
      {tab === 'collectie' && <BulkImport />}
      {tab === 'muziekweb' && beheerder && <MuziekwebImport />}
      {tab === 'datakwaliteit' && <Datakwaliteit />}
      {tab === 'historie' && <Historie />}
    </>
  )
}

function BestandKiezer({ accept, onKies, tekst }: { accept: string; onKies: (f: File) => void; tekst: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onKies(f); e.target.value = '' }} />
      <button className="btn btn-cyan" onClick={() => ref.current?.click()}><Upload size={18} /> {tekst}</button>
    </>
  )
}

function BulkImport() {
  const [a, setA] = useState<any>(null)
  const [keuze, setKeuze] = useState<Set<string>>(new Set())
  const [bezig, setBezig] = useState(false)
  const [rapport, setRapport] = useState<any>(null)
  const [m, setM] = useState<any>(null)
  const [open, setOpen] = useState<string | null>(null)
  const upload = async (f: File) => {
    setM(null); setA(null); setRapport(null); setBezig(true)
    const fd = new FormData(); fd.append('bestand', f)
    try {
      const r = await api('/beheer/import/collectie', { form: fd })
      setA(r)
      setKeuze(new Set(r.categorieen.filter((c: any) => c.aantal > 0 && c.sleutel !== 'ontbrekend').map((c: any) => c.sleutel)))
    } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } finally { setBezig(false) }
  }
  const voerDoor = async () => {
    setBezig(true)
    try { setRapport(await api(`/beheer/import/collectie/${a.token}`, { body: { categorieen: [...keuze] } })); setA(null) } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } finally { setBezig(false) }
  }
  return (
    <>
      <div className="card paneel">
        <p style={{ marginTop: 0 }}>Upload een Excel- of CSV-bestand met de kolommen <b>objectnummer</b> en <b>titelnummer</b> (en optioneel <b>vindcode</b>). Je ziet eerst een controle-overzicht; er wordt nog niets gewijzigd.</p>
        <p className="muted tekst-klein">Tabbladen waarvan de naam begint met OUD_ worden overgeslagen (open punt O-6). Regels als "AA00052;123456789" en ";123456789" (zonder titelnummer) worden herkend.</p>
        <BestandKiezer accept=".xlsx,.csv,.txt" onKies={upload} tekst="Bestand kiezen" />
      </div>
      <Melding m={m} />
      {bezig && <Laden tekst="Bezig met verwerken…" />}
      {a && (
        <div className="card paneel">
          <h2 style={{ marginTop: 0 }}>Controle-overzicht: {a.bestand}</h2>
          <p className="muted">{a.totaal.toLocaleString('nl-NL')} regels gelezen.{a.overgeslagen.length ? ` Overgeslagen tabbladen: ${a.overgeslagen.join(', ')}.` : ''} Kies per categorie wat er doorgevoerd wordt.</p>
          {a.categorieen.map((c: any) => (
            <div key={c.sleutel} className="veld-twee">
              <div className="kop">
                <label className="check"><input type="checkbox" disabled={c.aantal === 0} checked={keuze.has(c.sleutel)} onChange={(e) => { const n = new Set(keuze); e.target.checked ? n.add(c.sleutel) : n.delete(c.sleutel); setKeuze(n) }} /> {c.naam}</label>
                <span className="acties"><b>{c.aantal.toLocaleString('nl-NL')}</b>{c.aantal > 0 && <button className="btn btn-ghost btn-s" onClick={() => setOpen(open === c.sleutel ? null : c.sleutel)}>{open === c.sleutel ? 'Verberg' : 'Bekijk'}</button>}</span>
              </div>
              <div className="dim tekst-klein">{UITLEG[c.sleutel]}</div>
              {open === c.sleutel && (
                <table className="btabel" style={{ marginTop: 8 }}>
                  <thead><tr><th>Objectnummer</th><th>Titelnummer</th><th>Vindcode</th><th>Nu</th><th>Bron</th></tr></thead>
                  <tbody>{c.voorbeelden.map((r: any, i: number) => (
                    <tr key={i}><td>{r.objectnummer}</td><td>{r.titelnummer ?? '—'}</td><td>{r.vindcode ?? ''}</td><td className="dim">{r.bestaand ? `${r.bestaand.titelnummer ?? '—'} ${r.bestaand.vindcode ?? ''}` : ''}</td><td className="dim tekst-klein">{r.bron}{r.regel ? `, regel ${r.regel}` : ''}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setA(null)}>Annuleren</button>
            <button className="btn btn-pink" disabled={keuze.size === 0 || bezig} onClick={voerDoor}>Doorvoeren</button>
          </div>
        </div>
      )}
      {rapport && <div className="card paneel"><h2 style={{ marginTop: 0 }}>Rapport</h2><RapportWeergave r={rapport} /></div>}
    </>
  )
}

const UITLEG: Record<string, string> = {
  nieuw: 'Worden toegevoegd en gekoppeld aan de titel uit de Muziekweb-import.',
  gewijzigd: 'Het exemplaar krijgt het nieuwe titelnummer en/of de nieuwe vindcode. Exemplaren in een open aanvraag worden overgeslagen.',
  ontbrekend: 'Staan in de collectie maar niet in dit bestand. Doorvoeren = afvoeren met reden "overig".',
  onbekend: 'Titelnummer niet in de Muziekweb-import. Worden toegevoegd zonder titel en komen in de datakwaliteitslijst.',
  dubbel: 'Het objectnummer komt meer dan eens voor. De eerste regel telt; de rest komt in de datakwaliteitslijst.',
  zonder_titelnummer: 'Worden toegevoegd zonder titelnummer en komen in de datakwaliteitslijst.',
}

const NAMEN: Record<string, string> = {
  nieuw: 'Nieuwe exemplaren', gewijzigd: 'Gewijzigde koppeling', ontbrekend: 'Afgevoerd', onbekend: 'Onbekende titelnummers', dubbel: 'Dubbele objectnummers', zonder_titelnummer: 'Zonder titelnummer',
  in_dump: 'Records in de dump', bijgewerkt: 'Titels bijgewerkt', ongewijzigd: 'Ongewijzigd', nieuwe_titels: 'Nieuwe titels aangemaakt', nieuwe_conflicten: 'Nieuwe conflicten', niet_in_dump: 'Titels uit de collectie niet in de dump',
  nieuwe_albums: 'Nieuwe albums in fonotheek.db', nieuwe_exemplaren: 'Nieuwe exemplaren uit fonotheek.db',
}

function RapportWeergave({ r }: { r: any }) {
  const rijen: [string, any][] = []
  for (const [k, v] of Object.entries(r)) {
    if (k === 'doorgevoerd') for (const [k2, v2] of Object.entries(v as any)) rijen.push([NAMEN[k2] ?? k2, v2])
    else if (typeof v === 'number' && k !== 'import_id') rijen.push([NAMEN[k] ?? k, v])
  }
  return (
    <>
      <dl className="meer-info" style={{ marginTop: 0 }}>{rijen.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{Number(v).toLocaleString('nl-NL')}</dd></Fragment>)}</dl>
      {r.overgeslagen_in_gebruik?.length > 0 && <p className="tekst-klein muted">Overgeslagen omdat ze in een open aanvraag zitten: {r.overgeslagen_in_gebruik.join(', ')}</p>}
      {r.niet_in_dump_voorbeelden?.length > 0 && <p className="tekst-klein muted">Bijvoorbeeld: {r.niet_in_dump_voorbeelden.slice(0, 20).join(', ')}</p>}
      {r.nieuwe_albums_voorbeelden?.length > 0 && <p className="tekst-klein muted">Nieuwe albums, bijvoorbeeld: {r.nieuwe_albums_voorbeelden.slice(0, 20).join(' · ')}</p>}
      {r.bijgewerkt_voorbeelden?.length > 0 && <p className="tekst-klein muted">Bijgewerkt, bijvoorbeeld: {r.bijgewerkt_voorbeelden.slice(0, 20).join(', ')}</p>}
    </>
  )
}

function MuziekwebImport() {
  const [bezig, setBezig] = useState<string | null>(null)
  const [rapport, setRapport] = useState<any>(null)
  const [m, setM] = useState<any>(null)
  // In stappen: elk deel is één verzoek (Vercel-functies hebben een maximale duur).
  const voerUit = async (stap: (importId: number, delen: string[], bron: string) => Promise<string | void>) => {
    setM(null); setRapport(null)
    try {
      setBezig('Import starten…')
      const { import_id, delen, bron } = await api('/beheer/import/muziekweb/start', { method: 'POST' })
      const gebruikt = (await stap(import_id, delen, bron)) ?? bron
      setBezig('Afronden: losse exemplaren koppelen…')
      setRapport(await api('/beheer/import/muziekweb/afronden', { body: { import_id, bron: gebruikt } }))
    } catch (e) { setM({ soort: 'fout', tekst: `Import mislukt: ${(e as ApiFout).message}` }) } finally { setBezig(null) }
  }
  const meegeleverd = () => voerUit(async (id, delen, bron) => {
    if (!delen.length) throw new ApiFout(0, 'Geen fonotheek.db gevonden op de server')
    for (const [i, deel] of delen.entries()) {
      setBezig(bron === 'fonotheek' ? `Albums ${Number(deel.slice(10)) + 1} t/m ${Number(deel.slice(10)) + 2000} (stap ${i + 1} van ${delen.length})…` : `Deel ${i + 1} van ${delen.length} (${deel})…`)
      const r = await api('/beheer/import/muziekweb/deel', { body: { import_id: id, deel } })
      setRapport(r)
    }
  })
  const upload = (f: File) => voerUit(async (id) => {
    setBezig(`Uploaden: ${f.name}…`)
    const adres = await uploadBestand(f, (pct) => setBezig(`Uploaden: ${pct}%`))
    setBezig('Verwerken…')
    await api('/beheer/import/muziekweb/bestand', { body: { import_id: id, adres, naam: f.name } })
    return 'upload'
  })
  return (
    <>
      <div className="card paneel">
        <p style={{ marginTop: 0 }}>Een nieuwe Muziekweb-dump werkt de Muziekweb-waarden van alle titels bij. <b>Fonos-waarden worden nooit overschreven</b>; verandert Muziekweb een veld dat Fonos heeft aangepast, dan ontstaat een conflict.</p>
        <p className="muted tekst-klein">De app leest <b>fonotheek.db</b> (de database van de gebruikscollectie met de Muziekweb-gegevens) automatisch in bij elke nieuwe versie; nieuwe exemplaren met een titelnummer komen er dan ook bij. "fonotheek.db inlezen" doet dat nu opnieuw, in stappen. Een losse aanvulling kan als .jsonl, .jsonl.gz of zip met één exportdeel.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-cyan" disabled={!!bezig} onClick={meegeleverd}>fonotheek.db inlezen</button>
          <BestandKiezer accept=".zip,.jsonl,.gz" onKies={upload} tekst="Dump uploaden" />
        </div>
      </div>
      <Melding m={m} />
      {bezig && <div className="card paneel"><Laden tekst={bezig} /></div>}
      {rapport && <div className="card paneel"><h2 style={{ marginTop: 0 }}>{bezig ? 'Tussenstand' : 'Rapport'}</h2><RapportWeergave r={rapport} /></div>}
    </>
  )
}

function Datakwaliteit() {
  const [lijsten, setLijsten] = useState<any[] | null>(null)
  const [p, setP] = useSearchParams()
  const lijst = p.get('lijst')
  const [d, setD] = useState<any>(null)
  const [pagina, setPagina] = useState(1)
  const nav = useNavigate()
  const laad = () => api('/beheer/datakwaliteit').then(setLijsten)
  useEffect(() => { laad() }, [])
  useEffect(() => { setD(null); if (lijst) api(`/beheer/datakwaliteit/${lijst}?pagina=${pagina}`).then(setD) }, [lijst, pagina])
  return (
    <>
      {!lijsten ? <Laden /> : (
        <div className="dq-lijst">
          {lijsten.map((l) => (
            <button key={l.sleutel} className={`dq-item ${lijst === l.sleutel ? 'aan' : ''}`} onClick={() => { setPagina(1); setP({ tab: 'datakwaliteit', lijst: l.sleutel }) }}>
              <div className="w" style={{ color: l.aantal ? 'var(--amber)' : 'var(--green)' }}>{l.aantal.toLocaleString('nl-NL')}</div>
              <div className="l">{l.naam}</div>
            </button>
          ))}
        </div>
      )}
      {lijst && <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}><a className="btn btn-ghost btn-s" href={`/api/beheer/datakwaliteit-csv/${lijst}`}>Hele lijst als CSV (werklijst)</a></div>}
      {lijst && !d && <Laden />}
      {d && (
        <div className="tabel-kaart" style={{ background: '#030f1b' }}>
          <table className="btabel">
            <thead><tr>{d.rijen[0] ? Object.keys(d.rijen[0]).filter((k) => !k.endsWith('_id')).map((k) => <th key={k}>{k.replace(/_/g, ' ')}</th>) : <th>{d.naam}</th>}<th /></tr></thead>
            <tbody>
              {d.rijen.length === 0 && <tr><td className="muted" style={{ padding: 24 }}>Niets te doen.</td></tr>}
              {d.rijen.map((r: any, i: number) => (
                <tr key={i} className={r.titel_id || r.genre ? 'klikbaar' : ''} onClick={() => (r.titel_id ? nav(`/beheer/titel/${r.titel_id}`) : r.genre ? nav('/beheer/genreknoppen') : null)}>
                  {Object.entries(r).filter(([k]) => !k.endsWith('_id')).map(([k, v]) => <td key={k} className="tekst-klein">{Array.isArray(v) ? v.join(', ') : String(v ?? '')}</td>)}
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    {r.issue_id && <button className="btn btn-ghost btn-s" onClick={async () => { await api(`/beheer/issue/${r.issue_id}/afgehandeld`, { method: 'POST' }); laad(); api(`/beheer/datakwaliteit/${lijst}?pagina=${pagina}`).then(setD) }}>Afgehandeld</button>}
                    {r.titelnummer && <a className="btn btn-ghost btn-s" style={{ marginRight: 6 }} href={`https://www.muziekweb.nl/Link/${encodeURIComponent(r.titelnummer)}`} target="_blank" rel="noreferrer">Muziekweb</a>}
                    {r.exemplaar_id && !r.titel_id && <ExemplaarKoppel id={r.exemplaar_id} klaar={() => { laad(); api(`/beheer/datakwaliteit/${lijst}?pagina=${pagina}`).then(setD) }} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.totaal > 100 && (
            <div className="paginering">
              {d.totaal.toLocaleString('nl-NL')} regels
              <button className="btn btn-ghost btn-s" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Vorige</button>
              <button className="btn btn-ghost btn-s" disabled={pagina * 100 >= d.totaal} onClick={() => setPagina(pagina + 1)}>Volgende</button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** Een los exemplaar alsnog aan een titelnummer koppelen. */
function ExemplaarKoppel({ id, klaar }: { id: number; klaar: () => void }) {
  const [tn, setTn] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input className="invoer" style={{ minHeight: 36, width: 140, padding: '4px 10px' }} value={tn} onChange={(e) => setTn(e.target.value.toUpperCase())} placeholder="Titelnummer" />
      <button className="btn btn-ghost btn-s" disabled={!tn} onClick={async () => { try { await api(`/beheer/exemplaar/${id}`, { method: 'PATCH', body: { titelnummer: tn } }); klaar() } catch (e) { setFout((e as ApiFout).message) } }}>Koppel</button>
      {fout && <span className="tekst-klein" style={{ color: 'var(--red)' }}>{fout}</span>}
    </span>
  )
}

function Historie() {
  const [l, setL] = useState<any[] | null>(null)
  useEffect(() => { api('/beheer/imports').then(setL) }, [])
  if (!l) return <Laden />
  return (
    <div className="tabel-kaart" style={{ background: '#030f1b' }}>
      <table className="btabel">
        <thead><tr><th>Wanneer</th><th>Soort</th><th>Door</th><th>Samenvatting</th></tr></thead>
        <tbody>
          {l.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 24 }}>Nog geen imports.</td></tr>}
          {l.map((i) => (
            <tr key={i.id}>
              <td className="tekst-klein">{datumTijd(i.tijd)}</td>
              <td>{i.soort === 'muziekweb' ? 'Muziekweb' : 'Collectie'}</td>
              <td className="tekst-klein">{i.gebruiker}</td>
              <td className="tekst-klein">{i.soort === 'muziekweb'
                ? `${(i.rapport.in_dump ?? 0).toLocaleString('nl-NL')} records, ${i.rapport.bijgewerkt ?? 0} bijgewerkt, ${i.rapport.nieuwe_conflicten ?? 0} nieuwe conflicten`
                : `${i.rapport.bestand ?? ''}: ${Object.entries(i.rapport.doorgevoerd ?? {}).map(([k, v]) => `${NAMEN[k] ?? k} ${v}`).join(', ')}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
