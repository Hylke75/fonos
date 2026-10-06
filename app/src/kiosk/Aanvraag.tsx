// Aanvraaglijst en afronden (7.8, 7.9): titels, platenspeler kiezen, nieuwsbrief (optioneel), aanvraag versturen.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Trash2, X } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Hoes } from '../components/Hoes'
import { useKiosk } from './KioskApp'
import { KioskKopTerug } from './Kop'
import { EMAIL_RE, NieuwsbriefBlok, type NieuwsbriefKeuze } from './Nieuwsbrief'

export function Aanvraag() {
  const { mand, verwijder, leegMand, config, beschikbaar } = useKiosk()
  const [speler, setSpeler] = useState<number | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [vraagBezet, setVraagBezet] = useState(false)
  const [nietBeschikbaar, setNietBeschikbaar] = useState<number[]>([])
  const [nb, setNb] = useState<NieuwsbriefKeuze>({ aan: false, naam: '', email: '' })
  const [nbFout, setNbFout] = useState<string | null>(null)
  const nav = useNavigate()
  const spelers = config.platenspelers
  const ongeldig = (id: number) => nietBeschikbaar.includes(id) || beschikbaar[id]?.beschikbaar === false
  const kanVersturen = mand.length > 0 && speler != null && !mand.some((m) => ongeldig(m.titel_id)) && !bezig

  const verstuur = async (bezetAfsluiten = false) => {
    if (!speler) return
    if (nb.aan && !EMAIL_RE.test(nb.email.trim())) { setNbFout('Dit lijkt geen geldig e-mailadres. Controleer het nog even.'); return }
    setBezig(true)
    setFout(null)
    try {
      const r = await api<{ bestelnummer: number; platenspeler: number }>('/kiosk/aanvraag', {
        body: { platenspeler: speler, bezetAfsluiten, titels: mand.map((m) => ({ titel_id: m.titel_id, exemplaar_id: m.exemplaar_id ?? null })) },
      })
      // Nieuwsbrief los van de aanvraag doorsturen; een storing mag de aanvraag niet tegenhouden (11).
      let aangemeld = false
      if (nb.aan) aangemeld = await api('/kiosk/nieuwsbrief', { body: { email: nb.email.trim(), naam: nb.naam.trim() || undefined } }).then(() => true, () => false)
      nav('/verstuurd', { state: { ...r, aangemeld }, replace: true })
    } catch (e) {
      const f = e as ApiFout
      if (f.data?.code === 'bezet') setVraagBezet(true)
      else if (f.data?.code === 'niet_beschikbaar') { setNietBeschikbaar(f.data.titelIds ?? []); setFout('Een of meer titels zijn intussen in gebruik. Haal ze uit je aanvraag om verder te gaan.') }
      else setFout(f.message)
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="kiosk-scherm">
      <KioskKopTerug tekst="Verder zoeken" naar="/home" zoekIcoon={false} mand={false} />
      <main className="kiosk-inhoud">
        <div className="aanvraag-kop">
          <div>
            <h1>Jouw aanvraag</h1>
            <p className="muted" style={{ margin: 0, fontSize: 17 }}>Kies de platenspeler waar je naar wilt luisteren.</p>
          </div>
          {mand.length > 0 && <button className="btn btn-outline" onClick={leegMand}><Trash2 size={20} /> Leeg maken</button>}
        </div>

        <div className="aanvraag-grid">
          <div className="card aanvraag-lijst">
            {mand.length === 0 && (
              <div className="leeg" style={{ padding: 48 }}>
                <h2>Je aanvraag is nog leeg</h2>
                <p>Kies een of meer platen uit de collectie.</p>
                <button className="btn btn-pink" onClick={() => nav('/home')}>Ga zoeken</button>
              </div>
            )}
            {mand.map((m) => (
              <div key={m.titel_id} className={`aanvraag-regel ${ongeldig(m.titel_id) ? 'ongeldig' : ''}`}>
                <Hoes src={m.hoes} />
                <div className="namen">
                  <div>{m.artiesten || 'Diverse artiesten'}</div>
                  <div>{m.titel}</div>
                  {ongeldig(m.titel_id) && <div className="waarschuwing"><AlertTriangle size={14} /> Intussen in gebruik</div>}
                </div>
                <div className="info">
                  <div>{[m.drager, m.jaar].filter(Boolean).join(' · ')}</div>
                  {(m.vindcode ?? beschikbaar[m.titel_id]?.vindcode) && <div>Vindcode: {m.vindcode ?? beschikbaar[m.titel_id]?.vindcode}</div>}
                </div>
                <button className="x" onClick={() => { verwijder(m.titel_id); setNietBeschikbaar((n) => n.filter((x) => x !== m.titel_id)); setFout(null) }} aria-label={`Haal ${m.titel} uit je aanvraag`}><X size={26} /></button>
              </div>
            ))}
          </div>

          <div className="card spelers-paneel">
            <h2>Kies een platenspeler</h2>
            <div className="spelers" role="radiogroup" aria-label="Platenspeler">
              {spelers.map((p) => (
                <button key={p.nummer} className={`speler ${speler === p.nummer ? 'gekozen' : ''} ${p.bezet ? 'bezet' : ''}`} disabled={!p.actief}
                  role="radio" aria-checked={speler === p.nummer} aria-label={`Platenspeler ${p.nummer}${!p.actief ? ', niet beschikbaar' : p.bezet ? ', bezet' : ''}`}
                  onClick={() => setSpeler(p.nummer)}>
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
            {config.instellingen.nieuwsbrief && <NieuwsbriefBlok waarde={nb} wijzig={(w) => { setNb(w); setNbFout(null) }} fout={nbFout} />}
            <button className="btn btn-pink btn-l btn-block" disabled={!kanVersturen || (nb.aan && !nb.email.trim())} onClick={() => verstuur(false)}>
              {bezig ? 'Bezig met versturen…' : <>Aanvraag versturen <ArrowRight size={22} /></>}
            </button>
            {mand.length > 0 && speler == null && <p className="melding">Kies eerst je platenspeler.</p>}
            {fout && (
              <div className="melding" role="alert" style={{ color: '#ff8a98' }}>
                {fout}
                {!nietBeschikbaar.length && <div style={{ marginTop: 10 }}><button className="btn btn-ghost btn-s" onClick={() => verstuur(false)}>Opnieuw proberen</button></div>}
              </div>
            )}
          </div>
        </div>
      </main>

      {vraagBezet && (
        <div className="modal-achter" role="alertdialog" aria-labelledby="bezet-kop">
          <div className="card modal">
            <h2 id="bezet-kop">Platenspeler {speler} is bezet</h2>
            <p>Op deze speler loopt nog een aanvraag. Wil je die afsluiten?</p>
            <div className="knoppen">
              <button className="btn btn-pink btn-l" onClick={() => { setVraagBezet(false); verstuur(true) }}>Ja, afsluiten</button>
              <button className="btn btn-ghost btn-l" onClick={() => setVraagBezet(false)}>Nee, andere speler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
