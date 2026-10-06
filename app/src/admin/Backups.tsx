// Back-ups (12): handmatige download, automatische back-ups en terugzetten.
import { useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { api, ApiFout, datumTijd } from '../api'
import { Laden } from '../components/Iconen'
import { Melding, Modal } from './ui'

const mb = (n?: number) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '')
const SOORT: Record<string, string> = { dagelijks: 'Dagelijks', handmatig: 'Handmatig', voor_terugzetten: 'Vóór terugzetten' }

export function Backups() {
  const [d, setD] = useState<any>(null)
  const [hoezen, setHoezen] = useState(true)
  const [m, setM] = useState<any>(null)
  const [bezig, setBezig] = useState(false)
  const [controle, setControle] = useState<any>(null)
  const [woord, setWoord] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const laad = () => api('/beheer/backups').then(setD)
  useEffect(() => { laad() }, [])
  const kies = async (f: () => Promise<any>) => { setM(null); setBezig(true); try { setControle(await f()); setWoord('') } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } finally { setBezig(false) } }
  const zetTerug = async () => {
    setBezig(true)
    try { const r = await api('/beheer/terugzetten', { body: { token: controle.token, bevestiging: woord } }); setControle(null); setM({ soort: 'ok', tekst: `Back-up teruggezet. De stand van vlak daarvoor staat in ${r.back_up_vooraf}.` }); laad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } finally { setBezig(false) }
  }
  if (!d) return <Laden />
  const Telling = ({ t, naam }: { t: any; naam: string }) => <tr><td>{naam}</td><td>{t.totaal.toLocaleString('nl-NL')}</td><td>{t.toegevoegd}</td><td>{t.gewijzigd}</td><td>{t.verwijderd}</td></tr>
  return (
    <>
      <h1>Back-ups</h1>
      <Melding m={m} />
      <div className="drie-kol" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card paneel">
          <h2 style={{ marginTop: 0 }}>Handmatige download</h2>
          <p className="muted tekst-klein">Zip met JSON (om terug te zetten) en Excel (leesbaar, een tabblad per onderdeel). Zonder persoonsgegevens en wachtwoorden. De download wordt gelogd.</p>
          <label className="check"><input type="checkbox" checked={hoezen} onChange={(e) => setHoezen(e.target.checked)} /> Met door Fonos geüploade hoezen</label>
          <div style={{ marginTop: 12 }}><a className="btn btn-cyan" href={`/api/beheer/backup/download?hoezen=${hoezen ? 1 : 0}`}><Download size={18} /> Download back-up</a></div>
        </div>
        <div className="card paneel">
          <h2 style={{ marginTop: 0 }}>Terugzetten uit een bestand</h2>
          <p className="muted tekst-klein">Upload een gedownload zip- of JSON-bestand. Je ziet eerst wat er verandert.</p>
          <input ref={file} type="file" accept=".zip,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const fd = new FormData(); fd.append('bestand', f); kies(() => api('/beheer/terugzetten/controle', { form: fd })) } }} />
          <button className="btn btn-ghost" onClick={() => file.current?.click()}><Upload size={18} /> Bestand kiezen</button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2>Automatische back-ups</h2>
        <button className="btn btn-ghost btn-s" style={{ marginLeft: 'auto' }} disabled={bezig} onClick={async () => { setBezig(true); try { await api('/beheer/backups', { method: 'POST' }); laad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } finally { setBezig(false) } }}>Nu een back-up maken</button>
      </div>
      <p className="muted tekst-klein" style={{ marginTop: -6 }}>Elke nacht een volledige back-up in {d.map}, los van de database. Bij een mislukte back-up krijgen de beheerders een e-mail.</p>
      <div className="tabel-kaart" style={{ background: '#030f1b' }}>
        <table className="btabel">
          <thead><tr><th>Datum</th><th>Soort</th><th>Omvang</th><th>Status</th><th /></tr></thead>
          <tbody>
            {d.backups.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 24 }}>Nog geen back-ups.</td></tr>}
            {d.backups.map((b: any) => (
              <tr key={b.id}>
                <td>{datumTijd(b.tijd)}</td><td>{SOORT[b.soort] ?? b.soort}</td><td>{mb(b.omvang)}</td>
                <td>{b.status === 'gelukt' ? <span className="status status-actief">Gelukt</span> : <span className="status" style={{ background: '#3a1522', color: '#ff8a98', minWidth: 64, height: 28, fontSize: 13 }} title={b.fout}>Mislukt</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{b.status === 'gelukt' && <>
                  <a className="btn btn-ghost btn-s" href={`/api/beheer/backup/${b.id}/download`}>Downloaden</a>{' '}
                  <button className="btn btn-ghost btn-s" onClick={() => kies(() => api('/beheer/terugzetten/controle', { body: { id: b.id } }))}>Terugzetten</button>
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {controle && (
        <Modal titel="Back-up terugzetten" onSluit={() => setControle(null)} breed>
          <p>Back-up van <b>{datumTijd(controle.gemaakt)}</b> ({controle.bron}). Dit verandert er:</p>
          <table className="btabel">
            <thead><tr><th>Onderdeel</th><th>In back-up</th><th>Toegevoegd</th><th>Gewijzigd</th><th>Verwijderd</th></tr></thead>
            <tbody>
              <Telling t={controle.titels} naam="Titels" />
              <Telling t={controle.exemplaren} naam="Exemplaren" />
              {Object.entries(controle.configuratie).map(([k, t]) => <Telling key={k} t={t} naam={k.replace(/_/g, ' ')} />)}
            </tbody>
          </table>
          <p className="muted">Fonos-aanpassingen: nu {controle.fonos_aanpassingen.huidig}, in de back-up {controle.fonos_aanpassingen.backup}. Geüploade hoezen in de back-up: {controle.hoezen}.</p>
          {controle.open_aanvragen > 0 && <div className="melding-blok fout">Er lopen nu {controle.open_aanvragen} aanvragen. Die worden afgesloten.</div>}
          <p>Vlak voor het terugzetten maakt het systeem automatisch een back-up van de huidige stand. Typ <b>TERUGZETTEN</b> om te bevestigen.</p>
          <input className="invoer" value={woord} onChange={(e) => setWoord(e.target.value)} style={{ maxWidth: 300 }} aria-label="Bevestiging" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setControle(null)}>Annuleren</button>
            <button className="btn btn-pink" disabled={woord !== 'TERUGZETTEN' || bezig} onClick={zetTerug}>{bezig ? 'Bezig…' : 'Terugzetten'}</button>
          </div>
        </Modal>
      )}
    </>
  )
}
