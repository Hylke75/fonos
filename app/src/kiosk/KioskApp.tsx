// Bezoekersapp (7): context met aanvraaglijst, sessie, inactiviteit en realtime beschikbaarheid.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useVersies } from '../versies'
import { Rust } from './Rust'
import { Home } from './Home'
import { Zoeken } from './Zoeken'
import { Album } from './Album'
import { Artiest } from './Artiest'
import { Aanvraag } from './Aanvraag'
import { Verstuurd } from './Verstuurd'
import { Nieuwsbrief } from './Nieuwsbrief'
import { Lezen } from './Lezen'
import { Laden } from '../components/Iconen'

export type Item = { titel_id: number; exemplaar_id?: number | null; titel: string; artiesten: string; drager?: string | null; jaar?: number | null; hoes?: string | null; vindcode?: string | null }
export type Knop = { id: number; naam: string; kleur: string; beeld: string | null; nederlands: boolean; subfilters: string[] }
export type Config = {
  knoppen: Knop[]
  instellingen: { max_titels: number; inactiviteit_sec: number; waarschuwing_sec: number; bevestiging_sec: number; fonos_paginas: { naam: string; url: string }[]; privacy_tekst: string; privacy_url: string; nl_weergave: string; bumper_video_url: string }
  platenspelers: { nummer: number; actief: boolean; bezet: boolean }[]
}

type Ctx = {
  config: Config
  mand: Item[]
  beschikbaar: Record<number, { beschikbaar: boolean; vindcode: string | null }>
  voegToe: (i: Item) => boolean
  verwijder: (titelId: number) => void
  leegMand: () => void
  wisSessie: (naar?: string) => void
  toast: (t: string) => void
  versie: number // telt op bij elke beschikbaarheidswijziging
}
const KioskCtx = createContext<Ctx>(null as any)
export const useKiosk = () => useContext(KioskCtx)

export function KioskApp() {
  const [config, setConfig] = useState<Config | null>(null)
  const [mand, setMand] = useState<Item[]>([])
  const [beschikbaar, setBeschikbaar] = useState<Ctx['beschikbaar']>({})
  const [versie, setVersie] = useState(0)
  const [melding, setMelding] = useState<string | null>(null)
  const [nogDaar, setNogDaar] = useState<number | null>(null) // seconden tot wissen
  const nav = useNavigate()
  const loc = useLocation()
  const laatste = useRef(Date.now())
  const mandRef = useRef(mand)
  mandRef.current = mand

  const laadConfig = useCallback(() => api<Config>('/kiosk/config').then(setConfig).catch(() => {}), [])
  useEffect(() => { laadConfig() }, [laadConfig])

  // Beschikbaarheid van de titels in de aanvraaglijst bijhouden (7.8).
  const controleerMand = useCallback(() => {
    const ids = mandRef.current.map((i) => i.titel_id)
    if (ids.length) api<Ctx['beschikbaar']>('/kiosk/beschikbaarheid', { body: { ids } }).then(setBeschikbaar).catch(() => {})
  }, [])
  useEffect(() => { controleerMand() }, [mand.length, controleerMand])

  // Realtime: andere bezoekers vragen platen aan; spelers worden (in)actief.
  useVersies(() => { setVersie((v) => v + 1); controleerMand(); laadConfig() }, 5000)

  const toast = useCallback((t: string) => {
    setMelding(t)
    setTimeout(() => setMelding((m) => (m === t ? null : m)), 3200)
  }, [])

  /** Wist de sessie volledig: aanvraaglijst, zoekopdracht, nieuwsbriefgegevens (7.2). */
  const wisSessie = useCallback((naar = '/') => {
    setMand([])
    setBeschikbaar({})
    setNogDaar(null)
    try { sessionStorage.clear() } catch { /* niets */ }
    nav(naar, { replace: true })
    window.scrollTo(0, 0)
  }, [nav])

  // Inactiviteit: waarschuwing "Ben je er nog?" en daarna wissen. Niet op het rustscherm.
  useEffect(() => {
    if (!config) return
    const { inactiviteit_sec, waarschuwing_sec } = config.instellingen
    const tik = () => { laatste.current = Date.now(); setNogDaar(null) }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel']
    events.forEach((e) => window.addEventListener(e, tik, { passive: true, capture: true }))
    const i = setInterval(() => {
      if (loc.pathname === '/') return
      const stil = (Date.now() - laatste.current) / 1000
      if (stil >= inactiviteit_sec) wisSessie('/')
      else if (stil >= inactiviteit_sec - waarschuwing_sec) setNogDaar(Math.ceil(inactiviteit_sec - stil))
    }, 500)
    return () => { events.forEach((e) => window.removeEventListener(e, tik, { capture: true } as any)); clearInterval(i) }
  }, [config, loc.pathname, wisSessie])

  useEffect(() => { laatste.current = Date.now() }, [loc.pathname])

  const ctx = useMemo<Ctx | null>(() => config && {
    config, mand, beschikbaar, versie, toast, wisSessie,
    voegToe: (i) => {
      if (mand.some((m) => m.titel_id === i.titel_id)) return true
      if (mand.length >= config.instellingen.max_titels) {
        toast(`Je kunt maximaal ${config.instellingen.max_titels} titels tegelijk aanvragen.`)
        return false
      }
      setMand((m) => [...m, i])
      return true
    },
    verwijder: (id) => setMand((m) => m.filter((x) => x.titel_id !== id)),
    leegMand: () => setMand([]),
  }, [config, mand, beschikbaar, versie, toast, wisSessie])

  if (!ctx) return <div className="kiosk"><Laden tekst="De Fonotheek wordt geladen…" /></div>

  return (
    <KioskCtx.Provider value={ctx}>
      <div className="kiosk">
        <Routes>
          <Route path="/" element={<Rust />} />
          <Route path="/home" element={<Home />} />
          <Route path="/zoeken" element={<Zoeken />} />
          <Route path="/album/:id" element={<Album />} />
          <Route path="/artiest/:naam" element={<Artiest />} />
          <Route path="/aanvraag" element={<Aanvraag />} />
          <Route path="/verstuurd" element={<Verstuurd />} />
          <Route path="/nieuwsbrief" element={<Nieuwsbrief />} />
          <Route path="/lezen" element={<Lezen />} />
          <Route path="*" element={<Home />} />
        </Routes>
        {nogDaar != null && (
          <div className="modal-achter" role="alertdialog" aria-labelledby="nogdaar">
            <div className="card modal">
              <div className="aftellen" aria-live="polite">{nogDaar}</div>
              <h2 id="nogdaar">Ben je er nog?</h2>
              <p>Zonder aanraking wordt je sessie over {nogDaar} seconden gewist, ook je aanvraaglijst.</p>
              <div className="knoppen">
                <button className="btn btn-pink btn-l" onClick={() => { laatste.current = Date.now(); setNogDaar(null) }}>Ja, ik ben er nog</button>
                <button className="btn btn-ghost btn-l" onClick={() => wisSessie('/')}>Stoppen</button>
              </div>
            </div>
          </div>
        )}
        {melding && <div className="toast" role="status">{melding}</div>}
      </div>
    </KioskCtx.Provider>
  )
}
