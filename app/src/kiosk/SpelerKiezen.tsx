// Eerste stap in de kiosk: de bezoeker kiest de platenspeler waar hij gaat luisteren. Daarna zoeken en aanvragen.
// Kiezen kan met de knoppen of door de QR-code op de platenspeler te scannen met de camera van de tablet.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { QrCode, X } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Logo } from '../components/Logo'
import { useKiosk } from './KioskApp'
import { t } from './taal'
import { TaalKnop, TekstKnop } from './Kop'
import { Wachtlijst } from './Wachtlijst'

const STAPPEN = ['Kies je draaitafel', 'Zoek in de collectie', 'Vraag je platen aan', 'Geef je speler vrij als je klaar bent']

/** Haalt het spelernummer uit de QR-code (".../speler/3" of "FONOS-SPELER:3"). */
export const spelerUitCode = (tekst: string) => {
  const m = /speler[/:](\d{1,3})\b/i.exec(tekst)
  return m ? Number(m[1]) : null
}

export function SpelerKiezen() {
  const { config, kiesSpeler, toast, wacht } = useKiosk()
  const [bezig, setBezig] = useState<number | null>(null)
  const [scannen, setScannen] = useState(false)
  const spelers = config.platenspelers
  const kies = async (nummer: number) => {
    const p = spelers.find((x) => x.nummer === nummer)
    if (!p) { toast(t('Draaitafel {n} bestaat niet.', { n: nummer })); return }
    if (bezig != null) return // tijdens het kiezen geen tweede keuze, maar de knoppen blijven er gewoon uitzien
    setBezig(nummer)
    try { await kiesSpeler(nummer) } catch (e) { toast(t((e as ApiFout).message)) } finally { setBezig(null) }
  }
  const kanScannen = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia
  const vrij = spelers.filter((p) => p.actief && !p.bezet).length
  if (config.gekoppeld === false) return <Koppelen />
  return (
    <div className="kiosk-scherm">
      <header className="kiosk-header">
        <Link to="/" aria-label={t('Naar het beginscherm')}><Logo /></Link>
        <div className="rechts"><TekstKnop /><TaalKnop /></div>
      </header>
      <main className="kiosk-inhoud speler-kiezen">
        <ol className="stappen" aria-label={t('Zo werkt het')}>
          {STAPPEN.map((s, i) => <li key={s} className={i === 0 ? 'nu' : ''}><span>{i + 1}</span>{t(s)}</li>)}
        </ol>
        <h1>{t('Kies je draaitafel')}</h1>
        <p className="muted">{t('Kies de draaitafel waar je gaat luisteren. Daarna kun je zoeken en platen aanvragen.')}</p>
        <div className="card spelers-paneel">
          <div className="spelers groot" role="radiogroup" aria-label={t('Draaitafel')}>
            {spelers.map((p) => (
              <button key={p.nummer} className={`speler ${p.bezet ? 'bezet' : ''} ${bezig === p.nummer ? 'gekozen' : ''} ${bezig != null ? 'wacht' : ''}`} disabled={!p.actief || p.bezet}
                aria-busy={bezig === p.nummer}
                role="radio" aria-checked={bezig === p.nummer} aria-label={`${p.soort === 'cd' ? t('Cd-speler {n}', { n: p.nummer }) : t('Draaitafel {n}', { n: p.nummer })}${!p.actief ? t(', niet beschikbaar') : p.bezet ? t(', bezet') : ''}`}
                onClick={() => kies(p.nummer)}>
                {p.nummer}
                {p.bezet && p.actief ? <span className="klein">{t('bezet')}</span> : p.soort === 'cd' ? <span className="klein">CD</span> : null}
              </button>
            ))}
          </div>
          {spelers.some((p) => p.bezet || !p.actief || p.soort === 'cd') && (
            <div className="legenda">
              {spelers.some((p) => p.soort === 'cd') && <span>{t('CD = cd-speler, de rest zijn draaitafels')}</span>}
              {spelers.some((p) => p.bezet) && <span>{t('Stippellijn = bezet')}</span>}
              {spelers.some((p) => !p.actief) && <span>{t('Doorgestreept = niet beschikbaar')}</span>}
            </div>
          )}
          {(vrij === 0 || wacht) && <Wachtlijst />}
          {kanScannen && <button className="btn btn-ghost btn-l" onClick={() => setScannen(true)}><QrCode size={22} /> {t('Scan de code op je draaitafel')}</button>}
        </div>
      </main>
      {scannen && <Scanner onCode={(n) => { setScannen(false); kies(n) }} onSluit={() => setScannen(false)} />}
    </div>
  )
}

/** Nog niet gekoppelde tablet: alleen een medewerker kan hem koppelen, met de code uit Beheer → Status. */
function Koppelen() {
  const { laadConfig } = useKiosk()
  const [code, setCode] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const koppel = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true); setFout(null)
    try { await api('/kiosk/koppelen', { body: { code } }); await laadConfig() } catch (x) { setFout((x as Error).message) } finally { setBezig(false) }
  }
  return (
    <div className="kiosk-scherm">
      <header className="kiosk-header">
        <Link to="/" aria-label={t('Naar het beginscherm')}><Logo /></Link>
        <div className="rechts"><TekstKnop /><TaalKnop /></div>
      </header>
      <main className="kiosk-inhoud speler-kiezen">
        <h1>{t('Deze tablet is nog niet gekoppeld')}</h1>
        <p className="muted">{t('Op deze tablet kun je nog geen draaitafel kiezen of platen aanvragen. Vraag een medewerker om de tablet te koppelen.')}</p>
        <form className="card spelers-paneel koppel-form" onSubmit={koppel}>
          <label htmlFor="koppelcode">{t('Koppelcode (voor medewerkers)')}</label>
          <input id="koppelcode" className="kiosk-veld" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} placeholder="ABCD2345" />
          {fout && <p className="fout-tekst" role="alert">{fout}</p>}
          <button className="btn btn-pink btn-l" disabled={bezig || code.replace(/[^A-Z0-9]/g, '').length !== 8}>{t('Tablet koppelen')}</button>
          <p className="muted tekst-klein">{t('Een beheerder maakt de code in Beheer → Status → Kiosktablets.')}</p>
        </form>
      </main>
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
    kiesSpeler(Number(nr)).catch((e) => { toast(t((e as ApiFout).message)); nav('/speler', { replace: true }) })
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
      } catch { setFout(t('De camera kan niet worden gebruikt. Kies je draaitafel met de knoppen.')) }
    })()
    return () => { klaar = true; window.clearTimeout(timer); stroom?.getTracks().forEach((t) => t.stop()) }
  }, [onCode])
  return (
    <div className="modal-achter" role="dialog" aria-label={t('Code scannen')}>
      <div className="card modal scanner">
        <button className="icon-btn sluit" onClick={onSluit} aria-label={t('Sluiten')}><X size={22} /></button>
        <h2>{t('Houd de code op je draaitafel voor de camera')}</h2>
        {fout ? <p className="melding">{fout}</p> : <video ref={video} playsInline muted />}
      </div>
    </div>
  )
}
