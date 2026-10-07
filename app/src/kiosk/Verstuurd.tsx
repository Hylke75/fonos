// Bevestigingsscherm (7.9): bestelnummer en platenspeler. Na een paar seconden (instelbaar) terug naar de homepagina;
// de bezoeker houdt zijn platenspeler tot hij hem vrijgeeft.
import { useEffect, useRef } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Logo } from '../components/Logo'
import { useKiosk } from './KioskApp'
import { bestelnr } from '../api'

export function Verstuurd() {
  const st = useLocation().state as { bestelnummer: number; platenspeler: number; aangemeld?: boolean } | null
  const { leegMand, config, vraagVrijgeven } = useKiosk()
  const nav = useNavigate()
  const verder = () => nav('/home', { replace: true })
  const klaar = useRef(false)
  useEffect(() => { if (st) leegMand() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!st) return
    const t = setTimeout(() => { if (!klaar.current) verder() }, config.instellingen.bevestiging_sec * 1000)
    return () => clearTimeout(t)
  }, [st, config.instellingen.bevestiging_sec]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return <Navigate to="/home" replace />
  return (
    <div className="hero vormen-smal">
      <div className="vorm vorm-b" />
      <div className="vorm vorm-c" />
      <div style={{ position: 'absolute', top: 40, left: 56, zIndex: 3 }}><Logo /></div>
      <div className="midden" role="status">
        <div className="vink"><Check size={56} color="#bdf2fb" strokeWidth={2.5} /></div>
        <h1>Aanvraag verstuurd!</h1>
        <div className="label">Bestelnummer</div>
        <div className="nummer-groot">{bestelnr(st.bestelnummer)}</div>
        <p>Een FONOS-medewerker haalt de platen voor je op.<br />Deze worden gebracht naar platenspeler {st.platenspeler}.</p>
        {st.aangemeld && <p className="tekst-klein" style={{ fontSize: 17, marginTop: -12 }}>{config.instellingen.nieuwsbrief_bevestigingsmail ? 'Je ontvangt een e-mail om je aanmelding voor de nieuwsbrief te bevestigen.' : 'Je bent aangemeld voor de nieuwsbrief van Fonos.'}</p>}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button className="btn btn-ghost btn-l" style={{ minWidth: 240, background: '#0d1529' }} onClick={() => { klaar.current = true; verder() }}>Verder zoeken</button>
          <button className="btn btn-ghost btn-l" style={{ minWidth: 240, background: '#0d1529' }} onClick={() => { klaar.current = true; vraagVrijgeven() }}>Platenspeler vrijgeven</button>
        </div>
      </div>
    </div>
  )
}
