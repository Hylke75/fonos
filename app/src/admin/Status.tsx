// Status (verbetering 18): build, database, Muziekweb-data (nog in aanvoer), back-up, cron, kiosks en platenspelers.
// Ook: lijst van ontbrekende titelnummers voor de scraper (13) en QR-codes voor de platenspelers (1).
import { useEffect, useState } from 'react'
import { Download, Printer, RefreshCw } from 'lucide-react'
import QRCode from 'qrcode'
import { api, datumTijd } from '../api'
import { Laden } from '../components/Iconen'

export function Status() {
  const [s, setS] = useState<any>(null)
  const [qr, setQr] = useState<{ nummer: number; svg: string }[] | null>(null)
  const laad = () => api('/beheer/status').then(setS)
  useEffect(() => { laad(); const i = setInterval(laad, 30_000); return () => clearInterval(i) }, [])

  const maakQr = async () => {
    const lijst = await Promise.all((s?.platenspelers ?? []).map(async (p: any) => ({
      nummer: p.nummer, svg: await QRCode.toString(`${location.origin}/speler/${p.nummer}`, { type: 'svg', margin: 1, width: 240 }),
    })))
    setQr(lijst)
    setTimeout(() => window.print(), 300)
  }

  if (!s) return <Laden />
  const d = s.data
  const regel = (l: string, w: React.ReactNode, slecht = false) => <div className="status-regel"><span className="muted">{l}</span><b className={slecht ? 'slecht' : ''}>{w}</b></div>
  return (
    <>
      <div className="niet-afdrukken">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Status</h1>
          <button className="btn btn-ghost btn-s" onClick={laad}><RefreshCw size={14} /> Vernieuwen</button>
        </div>
        <div className="status-grid">
          <div className="card paneel">
            <h2>Systeem</h2>
            {regel('Omgeving', `${s.build.omgeving}${s.build.regio ? ` (${s.build.regio})` : ''}`)}
            {regel('Versie', s.build.commit ? `${s.build.commit} – ${s.build.bericht ?? ''}` : 'lokaal')}
            {regel('Database', s.database.ok ? `bereikbaar (${s.database.ms} ms)` : 'niet bereikbaar', !s.database.ok)}
            {regel('Laatste nachtelijke cron', s.laatste_cron ? datumTijd(s.laatste_cron) : 'nog niet', !s.laatste_cron)}
            {regel('Laatste back-up', s.laatste_backup ? `${datumTijd(s.laatste_backup.tijd)} (${s.laatste_backup.soort})` : 'nog geen', !s.laatste_backup)}
            {s.laatste_backup_fout && regel('Laatste mislukte back-up', `${datumTijd(s.laatste_backup_fout.tijd)}: ${s.laatste_backup_fout.fout ?? ''}`, true)}
          </div>
          <div className="card paneel">
            <h2>Muziekweb-data</h2>
            <p className="muted tekst-klein" style={{ marginTop: -6 }}>De gegevens komen uit fonotheek.db. Elke build met een nieuwe versie leest die in, voegt nieuwe exemplaren met een titelnummer toe en koppelt de exemplaren die daardoor bekend worden.</p>
            {regel('Records in de dump', d.muziekweb_records.toLocaleString('nl-NL'))}
            {regel('fonotheek.db', d.fonotheek_versie ? `versie ${d.fonotheek_versie}, geladen op ${d.fonotheek_geladen}` : 'nog niet geladen')}
            {regel('Laatste import', s.laatste_import ? datumTijd(s.laatste_import) : '–')}
            {regel('Titels / zichtbaar in de kiosk', `${d.titels.toLocaleString('nl-NL')} / ${d.zichtbare_titels.toLocaleString('nl-NL')}`)}
            {regel('Exemplaren in de collectie', d.exemplaren.toLocaleString('nl-NL'))}
            {regel('Wacht op Muziekweb-gegevens', `${d.wacht_op_muziekweb.toLocaleString('nl-NL')} exemplaren (${d.ontbrekende_titelnummers.toLocaleString('nl-NL')} titelnummers)`, d.wacht_op_muziekweb > 0)}
            <a className="btn btn-ghost btn-s" href="/api/beheer/ontbrekende-titelnummers.csv" download><Download size={14} /> Lijst ontbrekende titelnummers (CSV)</a>
          </div>
          <div className="card paneel">
            <h2>Kiosktablets</h2>
            <p className="muted tekst-klein" style={{ marginTop: -6 }}>Geef een tablet een naam door de kiosk één keer te openen met <code>?tablet=Bar links</code> achter het adres.</p>
            {s.kiosks.length === 0 && <p className="muted">Nog geen tablets met een naam.</p>}
            {s.kiosks.map((k: any) => regel(k.naam, `${k.online ? 'online' : 'offline'} · ${datumTijd(k.laatst_gezien)}${k.pagina ? ` · ${k.pagina}` : ''}`, !k.online))}
          </div>
          <div className="card paneel">
            <h2>Platenspelers</h2>
            {regel('Open aanvragen', s.open_aanvragen)}
            {s.platenspelers.map((p: any) => regel(`Speler ${p.nummer}`, !p.actief ? 'inactief' : p.vastgehouden ? `in gebruik sinds ${datumTijd(p.bezet_sinds)}` : 'vrij'))}
            <button className="btn btn-ghost btn-s" onClick={maakQr}><Printer size={14} /> QR-codes afdrukken</button>
            <p className="muted tekst-klein">Plak de code bij de platenspeler. Bezoekers scannen hem met de tablet om die speler te kiezen.</p>
          </div>
        </div>
      </div>
      {qr && (
        <div className="qr-blad">
          {qr.map((q) => (
            <div key={q.nummer} className="qr-kaart">
              <div dangerouslySetInnerHTML={{ __html: q.svg }} />
              <div className="qr-nr">Platenspeler {q.nummer}</div>
              <div className="qr-uitleg">Scan deze code met de tablet om deze speler te kiezen</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
