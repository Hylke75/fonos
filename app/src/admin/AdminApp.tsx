// Beheeromgeving (10): zijbalk, rollen en pagina's.
import { useEffect, useState } from 'react'
import { api } from '../api'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Activity, Archive, Disc3, History, Import, LayoutGrid, LibraryBig, ListMusic, LogOut, Mail, Settings, Users, Headphones } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Afgeschermd, heeftRol, initialen, type Ik } from '../Login'
import { Collectie } from './Collectie'
import { TitelBewerken } from './TitelBewerken'
import { Importeren } from './Importeren'
import { Genreknoppen } from './Genreknoppen'
import { Selecties } from './Selecties'
import { Nieuwsbrief } from './Nieuwsbrief'
import { Spotify } from './Spotify'
import { Status } from './Status'
import { Gebruikers } from './Gebruikers'
import { Instellingen } from './Instellingen'
import { Backups } from './Backups'
import { Wijzigingslog } from './Wijzigingslog'

export function AdminApp() {
  return (
    <Afgeschermd titel="Beheeromgeving" rollen={['redacteur', 'beheerder']}>
      {(ik, uit) => <Beheer ik={ik} uit={uit} />}
    </Afgeschermd>
  )
}

function Beheer({ ik, uit }: { ik: Ik; uit: () => void }) {
  const [menu, setMenu] = useState(false)
  const [spotify, setSpotify] = useState(false)
  useEffect(() => { api<{ spotify: boolean }>('/beheer/functies').then((f) => setSpotify(f.spotify)).catch(() => {}) }, [])
  const beheerder = heeftRol(ik, 'beheerder')
  const items = [
    { naar: 'collectie', label: 'Collectie', icoon: LibraryBig },
    { naar: 'importeren', label: 'Importeren', icoon: Import },
    ...(beheerder ? [{ naar: 'genreknoppen', label: 'Genreknoppen', icoon: LayoutGrid }] : []),
    { naar: 'selecties', label: 'Selecties', icoon: ListMusic },
    ...(spotify ? [{ naar: 'spotify', label: 'Spotify-koppelingen', icoon: Disc3 }] : []),
    ...(beheerder ? [
      { naar: 'nieuwsbrief', label: 'Nieuwsbrief', icoon: Mail },
      { naar: 'status', label: 'Status', icoon: Activity },
      { naar: 'gebruikers', label: 'Gebruikers', icoon: Users },
      { naar: 'instellingen', label: 'Instellingen', icoon: Settings },
      { naar: 'backups', label: 'Back-ups', icoon: Archive },
    ] : []),
    { naar: 'wijzigingslog', label: 'Wijzigingslog', icoon: History },
  ]
  return (
    <div className="beheer">
      <aside className="zijbalk">
        <Logo />
        <nav aria-label="Beheer">
          {items.map((i) => <NavLink key={i.naar} to={`/beheer/${i.naar}`}><i.icoon /> {i.label}</NavLink>)}
          {heeftRol(ik, 'medewerker') && <><div className="sep" /><NavLink to="/medewerker"><Headphones /> Medewerkersscherm</NavLink></>}
        </nav>
      </aside>
      <div className="beheer-main">
        <div className="beheer-top">
          <div style={{ position: 'relative' }}>
            <button className="gebruiker" onClick={() => setMenu(!menu)} aria-expanded={menu}>
              {beheerder ? 'Beheerder' : 'Redacteur'} <span className="avatar" title={ik.naam}>{initialen(ik.naam)}</span>
            </button>
            {menu && <div className="popmenu" style={{ top: 52 }}><div className="dim tekst-klein" style={{ padding: '8px 12px' }}>{ik.naam}<br />{ik.email}</div><button onClick={uit}><LogOut size={14} /> Uitloggen</button></div>}
          </div>
        </div>
        <main className="beheer-inhoud">
          <Routes>
            <Route path="/" element={<Navigate to="collectie" replace />} />
            <Route path="collectie" element={<Collectie />} />
            <Route path="titel/:id" element={<TitelBewerken beheerder={beheerder} />} />
            <Route path="importeren" element={<Importeren beheerder={beheerder} />} />
            <Route path="selecties" element={<Selecties />} />
            <Route path="spotify" element={<Spotify />} />
            <Route path="wijzigingslog" element={<Wijzigingslog />} />
            {beheerder && <>
              <Route path="genreknoppen" element={<Genreknoppen />} />
              <Route path="nieuwsbrief" element={<Nieuwsbrief />} />
              <Route path="status" element={<Status />} />
              <Route path="gebruikers" element={<Gebruikers ik={ik} />} />
              <Route path="instellingen" element={<Instellingen />} />
              <Route path="backups" element={<Backups />} />
            </>}
            <Route path="*" element={<p className="muted">Deze pagina bestaat niet of je hebt er geen rechten voor.</p>} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
