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
  // Kiosktablet koppelen (securityreview R1): eenmalige code, 30 minuten geldig.
  const [nieuweNaam, setNieuweNaam] = useState('')
  const [koppel, setKoppel] = useState<{ naam: string; code: string; tot: string; link: string; svg: string } | null>(null)
  const [kioskFout, setKioskFout] = useState<string | null>(null)
  const maakCode = async (naam: string) => {
    setKioskFout(null)
    try {
      const r = await api<{ naam: string; code: string; tot: string; link: string }>('/beheer/kiosks/koppelcode', { body: { naam } })
      setKoppel({ ...r, svg: await QRCode.toString(r.link, { type: 'svg', margin: 1, width: 200 }) })
      setNieuweNaam('')
      laad()
    } catch (e) { setKioskFout((e as Error).message) }
  }
  const ontkoppel = async (naam: string) => {
    if (!confirm(`Tablet "${naam}" ontkoppelen? Daarna kan hij geen draaitafel meer kiezen of aanvragen doen tot hij opnieuw gekoppeld is.`)) return
    await api(`/beheer/kiosk/${encodeURIComponent(naam)}`, { method: 'DELETE' })
    laad()
  }
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
            {s.inrichting && <>
              {regel('CRON_SECRET', s.inrichting.cron_geheim ? 'ingesteld' : 'ontbreekt: de nachtelijke cron wordt geweigerd', !s.inrichting.cron_geheim)}
              {regel('FONOS_GEHEIM_SLEUTEL', s.inrichting.geheimen_versleuteld ? 'ingesteld (geheimen versleuteld)' : 'ontbreekt: geheimen staan leesbaar in de database', !s.inrichting.geheimen_versleuteld)}
              {regel('Adres van de app', s.inrichting.basis_url ? 'ingesteld' : 'ontbreekt (FONOS_BASIS_URL)', !s.inrichting.basis_url)}
              {regel('Inloggen via Google', s.inrichting.google_login ? 'aan' : 'nog niet ingesteld')}
            </>}
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
            {regel('Hoezen die niet laden', (s.kapotte_hoezen ?? 0).toLocaleString('nl-NL'), (s.kapotte_hoezen ?? 0) > 0)}
            {regel('Wacht op Muziekweb-gegevens', `${d.wacht_op_muziekweb.toLocaleString('nl-NL')} exemplaren (${d.ontbrekende_titelnummers.toLocaleString('nl-NL')} titelnummers)`, d.wacht_op_muziekweb > 0)}
            <a className="btn btn-ghost btn-s" href="/api/beheer/ontbrekende-titelnummers.csv" download><Download size={14} /> Lijst ontbrekende titelnummers (CSV)</a>
          </div>
          <div className="card paneel">
            <h2>Kiosktablets</h2>
            <p className="muted tekst-klein" style={{ marginTop: -6 }}>Alleen gekoppelde tablets kunnen een draaitafel kiezen en platen aanvragen. Maak een koppelcode en open de link op de tablet (of typ de code in op het scherm "Kies je draaitafel"). De code is 30 minuten geldig en werkt één keer.</p>
            {s.kiosks.length === 0 && <p className="muted">Nog geen tablets.</p>}
            {s.kiosks.map((k: any) => (
              <div className="status-regel" key={k.naam}>
                <span className="muted">{k.naam}</span>
                <b className={!k.gekoppeld || !k.online ? 'slecht' : ''}>
                  {k.gekoppeld ? `gekoppeld · ${k.online ? 'online' : 'offline'} · ${datumTijd(k.laatst_gezien)}${k.pagina ? ` · ${k.pagina}` : ''}` : k.code_open ? 'code klaar, nog niet gekoppeld' : 'niet gekoppeld'}
                  {' '}{k.gekoppeld
                    ? <button className="btn btn-ghost btn-s" onClick={() => ontkoppel(k.naam)}>Ontkoppelen</button>
                    : <button className="btn btn-ghost btn-s" onClick={() => maakCode(k.naam)}>Koppelcode</button>}
                </b>
              </div>
            ))}
            <form style={{ display: 'flex', gap: 8, margin: '12px 0 4px' }} onSubmit={(e) => { e.preventDefault(); if (nieuweNaam.trim()) maakCode(nieuweNaam.trim()) }}>
              <input className="invoer" value={nieuweNaam} onChange={(e) => setNieuweNaam(e.target.value)} placeholder="Naam, bv. Bar links" aria-label="Naam van de nieuwe tablet" maxLength={60} />
              <button className="btn btn-pink btn-s" disabled={!nieuweNaam.trim()}>Tablet koppelen</button>
            </form>
            {kioskFout && <p className="fout-tekst" role="alert">{kioskFout}</p>}
            {koppel && (
              <div className="koppelcode" role="status">
                <div dangerouslySetInnerHTML={{ __html: koppel.svg }} />
                <div>
                  <p>Koppelcode voor <b>{koppel.naam}</b>, geldig tot {datumTijd(koppel.tot)}:</p>
                  <p className="code">{koppel.code.slice(0, 4)} {koppel.code.slice(4)}</p>
                  <p className="muted tekst-klein">Scan de QR-code met de tablet, open <code>{koppel.link}</code>, of typ de code in op de tablet.</p>
                  <button className="btn btn-ghost btn-s" onClick={() => setKoppel(null)}>Sluiten</button>
                </div>
              </div>
            )}
            <h3 style={{ margin: '18px 0 6px', fontSize: 16 }}>Fouten in de browser (24 uur)</h3>
            {s.browserfouten?.length ? s.browserfouten.map((f: any) => regel(`${f.aantal}× ${f.tablets}`, `${f.bericht.slice(0, 90)} · ${datumTijd(f.laatst)}`, true)) : <p className="muted tekst-klein">Geen fouten gemeld.</p>}
          </div>
          <div className="card paneel">
            <h2>Platenspelers</h2>
            {regel('Open aanvragen', s.open_aanvragen)}
            {regel('Op de wachtlijst', s.wachtlijst ?? 0)}
            {regel('Apparaten met pushmeldingen', s.push_apparaten ?? 0)}
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
