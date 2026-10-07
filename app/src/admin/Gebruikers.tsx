// Gebruikers (10.11): aanmaken, rollen, deactiveren, wachtwoord-reset per e-mail.
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Laden } from '../components/Iconen'
import { initialen, type Ik } from '../Login'
import { Melding, Toggle } from './ui'

const ROLLEN = ['medewerker', 'redacteur', 'beheerder']

export function Gebruikers({ ik }: { ik: Ik }) {
  const [l, setL] = useState<any[] | null>(null)
  const [m, setM] = useState<any>(null)
  const [n, setN] = useState({ naam: '', email: '', rollen: ['medewerker'] })
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
          <thead><tr><th>Naam</th><th>E-mail</th><th>Rollen</th><th>Actief</th><th /></tr></thead>
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
        <p className="muted tekst-klein">De nieuwe gebruiker krijgt een e-mail met een link om een wachtwoord te kiezen.</p>
        <button className="btn btn-cyan" disabled={!n.naam || !n.email || !n.rollen.length} onClick={() => doe(() => api('/beheer/gebruikers', { body: n }).then(() => setN({ naam: '', email: '', rollen: ['medewerker'] })), 'Gebruiker aangemaakt en uitnodiging verstuurd.')}><Plus size={18} /> Toevoegen</button>
      </div>
    </>
  )
}
