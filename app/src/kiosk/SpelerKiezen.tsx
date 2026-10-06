// Eerste stap in de kiosk: de bezoeker kiest de platenspeler waar hij gaat luisteren. Daarna zoeken en aanvragen.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiFout } from '../api'
import { Logo } from '../components/Logo'
import { useKiosk } from './KioskApp'

export function SpelerKiezen() {
  const { config, kiesSpeler, toast } = useKiosk()
  const [bezig, setBezig] = useState<number | null>(null)
  const spelers = config.platenspelers
  const kies = async (nummer: number) => {
    setBezig(nummer)
    try { await kiesSpeler(nummer) } catch (e) { toast((e as ApiFout).message) } finally { setBezig(null) }
  }
  const vrij = spelers.filter((p) => p.actief && !p.bezet).length
  return (
    <div className="kiosk-scherm">
      <header className="kiosk-header">
        <Link to="/" aria-label="Naar het beginscherm"><Logo /></Link>
        <div className="rechts"><span className="badge-nl" aria-label="Taal: Nederlands">NL</span></div>
      </header>
      <main className="kiosk-inhoud speler-kiezen">
        <h1>Kies je platenspeler</h1>
        <p className="muted">Kies de platenspeler waar je gaat luisteren. Daarna kun je zoeken en platen aanvragen.</p>
        <div className="card spelers-paneel">
          <div className="spelers groot" role="radiogroup" aria-label="Platenspeler">
            {spelers.map((p) => (
              <button key={p.nummer} className={`speler ${p.bezet ? 'bezet' : ''} ${bezig === p.nummer ? 'gekozen' : ''}`} disabled={!p.actief || p.bezet || bezig != null}
                role="radio" aria-checked={bezig === p.nummer} aria-label={`Platenspeler ${p.nummer}${!p.actief ? ', niet beschikbaar' : p.bezet ? ', bezet' : ''}`}
                onClick={() => kies(p.nummer)}>
                {p.nummer}
                {p.bezet && p.actief && <span className="klein">bezet</span>}
              </button>
            ))}
          </div>
          {spelers.some((p) => p.bezet || !p.actief) && (
            <div className="legenda">
              {spelers.some((p) => p.bezet) && <span>Stippellijn = bezet</span>}
              {spelers.some((p) => !p.actief) && <span>Doorgestreept = niet beschikbaar</span>}
            </div>
          )}
          {vrij === 0 && <p className="melding">Alle platenspelers zijn nu bezet. Vraag een medewerker of probeer het zo weer.</p>}
        </div>
      </main>
    </div>
  )
}
