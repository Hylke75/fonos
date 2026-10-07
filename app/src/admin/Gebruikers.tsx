// Gebruikers (10.11): aanmaken, rollen, deactiveren, wachtwoord-reset per e-mail.
// IT-beleid: soort account en einddatum (8.4), tweestapsverificatie (6.1) en het log van aanmeldingen (6.3).
import { useEffect, useState } from 'react'
import { Download, Plus } from 'lucide-react'
import { api, ApiFout, datumTijd } from '../api'
import { Laden } from '../components/Iconen'
import { initialen, type Ik } from '../Login'
import { Melding, Toggle } from './ui'

const ROLLEN = ['medewerker', 'redacteur', 'beheerder']
const SOORTEN: [string, string][] = [['vast', 'Vast (geen einddatum)'], ['tijdelijk', 'Tijdelijk (einde contract)'], ['extern', 'Extern (einde inhuur, uiterlijk 31 dec.)']]
const eindJaar = () => `${new Date().getFullYear()}-12-31`

function Geldigheid({ g, onZet }: { g: any; onZet: (b: { soort_account: string; geldig_tot: string | null }) => void }) {
  return (
    <div className="geldigheid">
      <select value={g.soort_account} onChange={(e) => onZet({ soort_account: e.target.value, geldig_tot: e.target.value === 'vast' ? null : (g.geldig_tot ?? (e.target.value === 'extern' ? eindJaar() : null)) })}>
        {SOORTEN.map(([k, v]) => <option key={k} value={k}>{v.split(' (')[0]}</option>)}
      </select>
      {g.soort_account !== 'vast' && <input type="date" value={g.geldig_tot ?? ''} onChange={(e) => e.target.value && onZet({ soort_account: g.soort_account, geldig_tot: e.target.value })} />}
      {g.verlopen && <span className="label-fout">verlopen</span>}
    </div>
  )
}

export function Gebruikers({ ik }: { ik: Ik }) {
  const [l, setL] = useState<any[] | null>(null)
  const [m, setM] = useState<any>(null)
  const leeg = { naam: '', email: '', rollen: ['medewerker'], soort_account: 'vast', geldig_tot: null as string | null }
  const [n, setN] = useState(leeg)
  const laad = () => api('/beheer/gebruikers').then(setL)
  useEffect(() => { laad() }, [])
  const doe = async (f: () => Promise<any>, ok: string) => { setM(null); try { await f(); setM({ soort: 'ok', tekst: ok }); laad() } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) } }
  if (!l) return <Laden />
  return (
    <>
      <h1>Gebruikers</h1>
      <Melding m={m} />
      <div className="tabel-kaart" style={{ background: '#030f1b', marginBottom: 20 }}>
        <table className="btabel">
          <thead><tr><th>Naam</th><th>E-mail</th><th>Rollen</th><th>Account</th><th>Tweestaps</th><th>Laatst ingelogd</th><th>Actief</th><th /></tr></thead>
          <tbody>
            {l.map((g) => (
              <tr key={g.id}>
                <td><div className="titel-cel"><span className="avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{initialen(g.naam)}</span>{g.naam}</div></td>
                <td>{g.email}</td>
                <td>{ROLLEN.map((r) => (
                  <label key={r} className="check" style={{ marginRight: 14 }}>
                    <input type="checkbox" checked={g.rollen.includes(r)} disabled={g.id === ik.id && r === 'beheerder'}
                      onChange={(e) => doe(() => api(`/beheer/gebruiker/${g.id}`, { method: 'PATCH', body: { rollen: e.target.checked ? [...g.rollen, r] : g.rollen.filter((x: string) => x !== r) } }), 'Rollen opgeslagen.')} /> {r}
                  </label>
                ))}</td>
                <td><Geldigheid g={g} onZet={(b) => doe(() => api(`/beheer/gebruiker/${g.id}`, { method: 'PATCH', body: b }), 'Account opgeslagen.')} /></td>
                <td>{g.totp_aan ? <>Ingesteld <button className="btn btn-ghost btn-s" style={{ marginLeft: 6 }} onClick={() => confirm(`Tweestapsverificatie van ${g.naam} resetten? Bij de volgende keer inloggen koppelt ${g.naam} opnieuw een authenticator-app.`) && doe(() => api(`/beheer/gebruiker/${g.id}/tweestaps-reset`, { method: 'POST' }), 'Tweestapsverificatie gereset.')}>Resetten</button></> : <span className="muted">Nog niet</span>}</td>
                <td className="muted tekst-klein">{g.laatste_aanmelding ? datumTijd(g.laatste_aanmelding) : '–'}</td>
                <td><Toggle aan={g.actief} onChange={(v) => doe(() => api(`/beheer/gebruiker/${g.id}`, { method: 'PATCH', body: { actief: v } }), v ? 'Gebruiker geactiveerd.' : 'Gebruiker gedeactiveerd.')} label="" /></td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-s" onClick={() => doe(() => api(`/beheer/gebruiker/${g.id}/reset`, { method: 'POST' }), `Resetlink verstuurd naar ${g.email}.`)}>Wachtwoord-reset sturen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card paneel">
        <h2 style={{ marginTop: 0 }}>Gebruiker toevoegen</h2>
        <div className="drie-kol">
          <label className="veld"><span>Naam</span><input value={n.naam} onChange={(e) => setN({ ...n, naam: e.target.value })} /></label>
          <label className="veld"><span>E-mailadres</span><input type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></label>
          <div className="veld"><span>Rollen</span><div>{ROLLEN.map((r) => <label key={r} className="check" style={{ marginRight: 14 }}><input type="checkbox" checked={n.rollen.includes(r)} onChange={(e) => setN({ ...n, rollen: e.target.checked ? [...n.rollen, r] : n.rollen.filter((x) => x !== r) })} /> {r}</label>)}</div></div>
        </div>
        <div className="drie-kol">
          <label className="veld"><span>Soort account</span>
            <select value={n.soort_account} onChange={(e) => setN({ ...n, soort_account: e.target.value, geldig_tot: e.target.value === 'vast' ? null : e.target.value === 'extern' ? eindJaar() : n.geldig_tot })}>
              {SOORTEN.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {n.soort_account !== 'vast' && <label className="veld"><span>Einddatum (laatste geldige dag)</span><input type="date" value={n.geldig_tot ?? ''} max={n.soort_account === 'extern' ? eindJaar() : undefined} onChange={(e) => setN({ ...n, geldig_tot: e.target.value || null })} /></label>}
        </div>
        <p className="muted tekst-klein">De nieuwe gebruiker begint met alleen de gekozen rollen en krijgt een e-mail met een link om een wachtwoord te kiezen. Tijdelijke en externe accounts verlopen na de einddatum; verlenging gaat via HR.</p>
        <button className="btn btn-cyan" disabled={!n.naam || !n.email || !n.rollen.length || (n.soort_account !== 'vast' && !n.geldig_tot)} onClick={() => doe(() => api('/beheer/gebruikers', { body: n }).then(() => setN(leeg)), 'Gebruiker aangemaakt en uitnodiging verstuurd.')}><Plus size={18} /> Toevoegen</button>
      </div>
      <Aanmeldingen />
    </>
  )
}

const REDENEN: Record<string, string> = {
  onbekend: 'onbekend adres', wachtwoord: 'verkeerd wachtwoord', inactief: 'account inactief', verlopen: 'account verlopen',
  code: 'verkeerde code', geblokkeerd: 'geblokkeerd (te veel pogingen)', domein: 'Google geweigerd', gekoppeld: 'authenticator gekoppeld',
}
const METHODEN: Record<string, string> = { wachtwoord: 'Wachtwoord', tweede_stap: 'Tweede stap', google: 'Google', uitloggen: 'Uitgelogd' }

/** Log van alle aanmeldingen (IT-beleid 6.3). */
function Aanmeldingen() {
  const [d, setD] = useState<any>(null)
  const [alleenMislukt, setAlleenMislukt] = useState(false)
  const [zoek, setZoek] = useState('')
  const [pagina, setPagina] = useState(1)
  const q = new URLSearchParams({ ...(alleenMislukt ? { gelukt: '0' } : {}), ...(zoek ? { email: zoek } : {}) })
  useEffect(() => { api(`/beheer/aanmeldingen?${q}&pagina=${pagina}`).then(setD).catch(() => setD({ rijen: [], totaal: 0 })) }, [alleenMislukt, zoek, pagina])
  return (
    <div className="card paneel" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1 }}>Aanmeldingen</h2>
        {d?.mislukt_24u > 0 && <span className="label-fout">{d.mislukt_24u} mislukt in 24 uur</span>}
        <label className="veld" style={{ margin: 0, width: 260 }}><input placeholder="Zoek op e-mailadres" value={zoek} onChange={(e) => { setPagina(1); setZoek(e.target.value) }} /></label>
        <label className="check"><input type="checkbox" checked={alleenMislukt} onChange={(e) => { setPagina(1); setAlleenMislukt(e.target.checked) }} /> Alleen mislukt</label>
        <a className="btn btn-ghost btn-s" href={`/api/beheer/aanmeldingen.csv?${q}`}><Download size={16} /> CSV</a>
      </div>
      <p className="muted tekst-klein">Alle geslaagde en mislukte aanmeldingen, met tijd, IP-adres en apparaat. Na 10 mislukte pogingen in een kwartier is een account een kwartier geblokkeerd en krijgen beheerders een melding.</p>
      {!d ? <Laden /> : (
        <table className="btabel">
          <thead><tr><th>Tijd</th><th>E-mail</th><th>Methode</th><th>Resultaat</th><th>IP-adres</th><th>Apparaat</th></tr></thead>
          <tbody>
            {d.rijen.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>Geen aanmeldingen.</td></tr>}
            {d.rijen.map((r: any) => (
              <tr key={r.id}>
                <td className="tekst-klein">{datumTijd(r.tijd)}</td>
                <td>{r.email ?? '–'}</td>
                <td>{METHODEN[r.methode] ?? r.methode}</td>
                <td>{r.gelukt ? <span style={{ color: 'var(--green)' }}>gelukt{r.reden ? ` (${REDENEN[r.reden] ?? r.reden})` : ''}</span> : <span style={{ color: 'var(--amber)' }}>mislukt: {REDENEN[r.reden] ?? r.reden}</span>}</td>
                <td className="tekst-klein">{r.ip ?? '–'}</td>
                <td className="tekst-klein muted" title={r.apparaat ?? ''} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.apparaat ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && d.totaal > 100 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-s" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Vorige</button>
          <span className="muted tekst-klein">Pagina {pagina} van {Math.ceil(d.totaal / 100)}</span>
          <button className="btn btn-ghost btn-s" disabled={pagina * 100 >= d.totaal} onClick={() => setPagina(pagina + 1)}>Volgende</button>
        </div>
      )}
    </div>
  )
}
