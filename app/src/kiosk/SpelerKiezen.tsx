// Eerste stap in de kiosk: de bezoeker kiest de platenspeler waar hij gaat luisteren. Daarna zoeken en aanvragen.
// Kiezen kan met de knoppen of door de QR-code op de platenspeler te scannen met de camera van de tablet.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { QrCode, X } from 'lucide-react'
import { ApiFout } from '../api'
import { Logo } from '../components/Logo'
import { useKiosk } from './KioskApp'

const STAPPEN = ['Kies je platenspeler', 'Zoek in de collectie', 'Vraag je platen aan', 'Geef je speler vrij als je klaar bent']

/** Haalt het spelernummer uit de QR-code (".../speler/3" of "FONOS-SPELER:3"). */
export const spelerUitCode = (tekst: string) => {
  const m = /speler[/:](\d{1,3})\b/i.exec(tekst)
  return m ? Number(m[1]) : null
}

export function SpelerKiezen() {
  const { config, kiesSpeler, toast } = useKiosk()
  const [bezig, setBezig] = useState<number | null>(null)
  const [scannen, setScannen] = useState(false)
  const spelers = config.platenspelers
  const kies = async (nummer: number) => {
    const p = spelers.find((x) => x.nummer === nummer)
    if (!p) { toast(`Platenspeler ${nummer} bestaat niet.`); return }
    setBezig(nummer)
    try { await kiesSpeler(nummer) } catch (e) { toast((e as ApiFout).message) } finally { setBezig(null) }
  }
  const kanScannen = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia
  const vrij = spelers.filter((p) => p.actief && !p.bezet).length
  return (
    <div className="kiosk-scherm">
      <header className="kiosk-header">
        <Link to="/" aria-label="Naar het beginscherm"><Logo /></Link>
        <div className="rechts"><span className="badge-nl" aria-label="Taal: Nederlands">NL</span></div>
      </header>
      <main className="kiosk-inhoud speler-kiezen">
        <ol className="stappen" aria-label="Zo werkt het">
          {STAPPEN.map((s, i) => <li key={s} className={i === 0 ? 'nu' : ''}><span>{i + 1}</span>{s}</li>)}
        </ol>
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
          {kanScannen && <button className="btn btn-ghost btn-l" onClick={() => setScannen(true)}><QrCode size={22} /> Scan de code op je platenspeler</button>}
        </div>
      </main>
      {scannen && <Scanner onCode={(n) => { setScannen(false); kies(n) }} onSluit={() => setScannen(false)} />}
    </div>
  )
}

/** Directe link of QR-code naar /speler/3: die speler meteen kiezen. */
export function SpelerViaLink() {
  const { nr } = useParams()
  const { kiesSpeler, toast } = useKiosk()
  const nav = useNavigate()
  const gedaan = useRef(false)
  useEffect(() => {
    if (gedaan.current) return
    gedaan.current = true
    kiesSpeler(Number(nr)).catch((e) => { toast((e as ApiFout).message); nav('/speler', { replace: true }) })
  }, [nr]) // eslint-disable-line react-hooks/exhaustive-deps
  return <SpelerKiezen />
}

function Scanner({ onCode, onSluit }: { onCode: (n: number) => void; onSluit: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [fout, setFout] = useState<string | null>(null)
  useEffect(() => {
    let stroom: MediaStream | null = null
    let timer: number | undefined
    let klaar = false
    ;(async () => {
      try {
        stroom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!video.current) return
        video.current.srcObject = stroom
        await video.current.play()
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        const zoek = async () => {
          if (klaar || !video.current) return
          const codes = await detector.detect(video.current).catch(() => [])
          const n = codes.map((c: any) => spelerUitCode(c.rawValue)).find((x: number | null) => x != null)
          if (n != null) { klaar = true; onCode(n); return }
          timer = window.setTimeout(zoek, 300)
        }
        zoek()
      } catch { setFout('De camera kan niet worden gebruikt. Kies je platenspeler met de knoppen.') }
    })()
    return () => { klaar = true; window.clearTimeout(timer); stroom?.getTracks().forEach((t) => t.stop()) }
  }, [onCode])
  return (
    <div className="modal-achter" role="dialog" aria-label="Code scannen">
      <div className="card modal scanner">
        <button className="icon-btn sluit" onClick={onSluit} aria-label="Sluiten"><X size={22} /></button>
        <h2>Houd de code op je platenspeler voor de camera</h2>
        {fout ? <p className="melding">{fout}</p> : <video ref={video} playsInline muted />}
      </div>
    </div>
  )
}
