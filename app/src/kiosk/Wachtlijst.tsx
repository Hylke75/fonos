// Wachtlijst (verbetering 8): alle platenspelers bezet? Zet je op de lijst; komt er een speler vrij,
// dan houden we die een paar minuten voor je vast en verschijnt hier een melding.
import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { api, ApiFout } from '../api'
import { useKiosk } from './KioskApp'
import { t } from './taal'

type Status = { status: 'wacht'; positie: number } | { status: 'opgeroepen'; speler: number; seconden: number } | { status: 'geholpen' | 'verlopen' | 'afgemeld' | 'onbekend' }

export function Wachtlijst() {
  const { wacht, zetWacht, kiesSpeler, toast } = useKiosk()
  const [s, setS] = useState<Status | null>(null)
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    if (!wacht) { setS(null); return }
    let weg = false
    const vraag = () => api<Status>(`/kiosk/wachtlijst/${wacht}`).then((r) => {
      if (weg) return
      setS(r)
      if (r.status === 'verlopen' || r.status === 'afgemeld' || r.status === 'onbekend') { zetWacht(null); toast(t('Je beurt op de wachtlijst is verlopen.')) }
    }).catch(() => {})
    vraag()
    const i = setInterval(vraag, 4000)
    return () => { weg = true; clearInterval(i) }
  }, [wacht]) // eslint-disable-line react-hooks/exhaustive-deps
  // Aftellen tussen de verzoeken door.
  useEffect(() => {
    if (s?.status !== 'opgeroepen') return
    const i = setInterval(() => setS((x) => (x?.status === 'opgeroepen' ? { ...x, seconden: Math.max(0, x.seconden - 1) } : x)), 1000)
    return () => clearInterval(i)
  }, [s?.status])

  const aanmelden = async () => {
    setBezig(true)
    try { const r = await api<{ token: string } & Status>('/kiosk/wachtlijst', { method: 'POST' }); zetWacht(r.token); setS(r) } catch (e) { toast(t((e as ApiFout).message)) } finally { setBezig(false) }
  }
  const afmelden = async () => { if (wacht) await api(`/kiosk/wachtlijst/${wacht}`, { method: 'DELETE' }).catch(() => {}); zetWacht(null) }
  const kies = async (n: number) => {
    setBezig(true)
    try { await kiesSpeler(n, wacht); zetWacht(null) } catch (e) { toast(t((e as ApiFout).message)) } finally { setBezig(false) }
  }

  if (!wacht) return (
    <div className="wachtlijst">
      <p className="melding">{t('Alle platenspelers zijn nu bezet.')}</p>
      <button className="btn btn-pink btn-l" disabled={bezig} onClick={aanmelden}><Clock size={22} /> {t('Zet me op de wachtlijst')}</button>
    </div>
  )
  return (
    <>
      <div className="wachtlijst" role="status" aria-live="polite">
        <h2>{t('Je staat op de wachtlijst')}</h2>
        {s?.status === 'wacht' && <p>{t('Nummer {n} op de wachtlijst. Laat deze tablet open; je krijgt hier een seintje zodra er een platenspeler vrij is.', { n: s.positie })}</p>}
        <button className="btn btn-ghost" onClick={afmelden}>{t('Van de wachtlijst af')}</button>
      </div>
      {s?.status === 'opgeroepen' && (
        <div className="modal-achter" role="alertdialog" aria-labelledby="wacht-kop">
          <div className="card modal">
            <div className="aftellen" aria-live="polite">{Math.floor(s.seconden / 60)}:{String(s.seconden % 60).padStart(2, '0')}</div>
            <h2 id="wacht-kop">{t('Platenspeler {n} is vrij voor jou!', { n: s.speler })}</h2>
            <p>{t('We houden hem nog {tijd} voor je vast.', { tijd: `${Math.floor(s.seconden / 60)}:${String(s.seconden % 60).padStart(2, '0')}` })}</p>
            <div className="knoppen">
              <button className="btn btn-pink btn-l" disabled={bezig} onClick={() => kies(s.speler)}>{t('Kies platenspeler {n}', { n: s.speler })}</button>
              <button className="btn btn-ghost btn-l" onClick={afmelden}>{t('Nee, dank je')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
