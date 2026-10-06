// Bezoekersapp (7): context met gekozen platenspeler, aanvraaglijst, sessie, inactiviteit en realtime beschikbaarheid.
// Volgorde: rustscherm → platenspeler kiezen → zoeken en aanvragen → platenspeler vrijgeven.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useVersies } from '../versies'
import { Rust } from './Rust'
import { Home } from './Home'
import { Zoeken } from './Zoeken'
import { Album } from './Album'
import { Artiest } from './Artiest'
import { Aanvraag } from './Aanvraag'
import { Verstuurd } from './Verstuurd'
import { Lezen } from './Lezen'
import { SpelerKiezen } from './SpelerKiezen'
import { Laden } from '../components/Iconen'

export type Item = { titel_id: number; exemplaar_id?: number | null; titel: string; artiesten: string; drager?: string | null; jaar?: number | null; hoes?: string | null; vindcode?: string | null }
export type Knop = { id: number; naam: string; kleur: string; beeld: string | null; nederlands: boolean; subfilters: string[] }
export type Config = {
  knoppen: Knop[]
  instellingen: { max_titels: number; inactiviteit_sec: number; waarschuwing_sec: number; bevestiging_sec: number; speler_inactief_min: number; speler_reactie_min: number; fonos_paginas: { naam: string; url: string }[]; privacy_tekst: string; privacy_url: string; nl_weergave: string; bumper_video_url: string; nieuwsbrief: boolean; nieuwsbrief_bevestigingsmail: boolean; vindcode_label: string }
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
  speler: Speler | null
  kiesSpeler: (nummer: number) => Promise<void>
  vraagVrijgeven: () => void
  spelerKwijt: () => void
}
export type Speler = { nummer: number; sessie: string }
const SPELER_SLEUTEL = 'fonos-speler'
const leesSpeler = (): Speler | null => { try { return JSON.parse(sessionStorage.getItem(SPELER_SLEUTEL) ?? 'null') } catch { return null } }
const KioskCtx = createContext<Ctx>(null as any)
export const useKiosk = () => useContext(KioskCtx)

export function KioskApp() {
  const [config, setConfig] = useState<Config | null>(null)
  const [mand, setMand] = useState<Item[]>([])
  const [beschikbaar, setBeschikbaar] = useState<Ctx['beschikbaar']>({})
  const [versie, setVersie] = useState(0)
  const [melding, setMelding] = useState<string | null>(null)
  const [nogDaar, setNogDaar] = useState<number | null>(null) // seconden tot wissen (zonder speler)
  const [spelerVraag, setSpelerVraag] = useState<number | null>(null) // seconden tot automatisch vrijgeven
  const [vrijgevenVraag, setVrijgevenVraag] = useState(false)
  const [speler, setSpelerState] = useState<Speler | null>(leesSpeler)
  const spelerRef = useRef(speler)
  spelerRef.current = speler
  const laatsteHartslag = useRef(0)
  const nav = useNavigate()
  const loc = useLocation()
  const laatste = useRef(Date.now())
  const mandRef = useRef(mand)
  mandRef.current = mand

  const [onbereikbaar, setOnbereikbaar] = useState(false)
  const laadConfig = useCallback(() => api<Config>('/kiosk/config').then((c) => { setConfig(c); setOnbereikbaar(false) }).catch(() => setOnbereikbaar(true)), [])
  useEffect(() => { laadConfig() }, [laadConfig])
  // Lukt de eerste keer laden niet, dan elke 10 seconden opnieuw proberen.
  useEffect(() => {
    if (config || !onbereikbaar) return
    const t = setTimeout(laadConfig, 10000)
    return () => clearTimeout(t)
  }, [config, onbereikbaar, laadConfig])

  // Beschikbaarheid van de titels in de aanvraaglijst bijhouden (7.8).
  const controleerMand = useCallback(() => {
    const ids = mandRef.current.map((i) => i.titel_id)
    if (ids.length) api<Ctx['beschikbaar']>('/kiosk/beschikbaarheid', { body: { ids } }).then(setBeschikbaar).catch(() => {})
  }, [])
  useEffect(() => { controleerMand() }, [mand.length, controleerMand])

  const zetSpeler = (s: Speler | null) => {
    setSpelerState(s)
    try { s ? sessionStorage.setItem(SPELER_SLEUTEL, JSON.stringify(s)) : sessionStorage.removeItem(SPELER_SLEUTEL) } catch { /* niets */ }
  }

  /** Laat de server weten dat de speler nog in gebruik is. Is hij intussen vrijgegeven (medewerker, sluitingstijd), dan opnieuw beginnen. */
  const hartslag = useCallback(async (nu = false) => {
    const s = spelerRef.current
    if (!s || (!nu && Date.now() - laatsteHartslag.current < 60_000)) return
    laatsteHartslag.current = Date.now()
    const r = await api<{ ok: boolean }>('/kiosk/speler/vasthouden', { body: { platenspeler: s.nummer, sessie: s.sessie } }).catch(() => null)
    if (r && !r.ok) kwijtRef.current()
  }, [])
  const kwijtRef = useRef(() => {})

  // Realtime: andere bezoekers vragen platen aan; spelers worden (in)actief of vrijgegeven.
  useVersies(() => { setVersie((v) => v + 1); controleerMand(); laadConfig(); hartslag(true) }, 5000)

  const toast = useCallback((t: string) => {
    setMelding(t)
    setTimeout(() => setMelding((m) => (m === t ? null : m)), 3200)
  }, [])

  /** Wist de sessie volledig: platenspeler, aanvraaglijst, zoekopdracht, nieuwsbriefgegevens (7.2). */
  const wisSessie = useCallback((naar = '/') => {
    setMand([])
    setBeschikbaar({})
    setNogDaar(null)
    setSpelerVraag(null)
    setVrijgevenVraag(false)
    setSpelerState(null)
    try { sessionStorage.clear() } catch { /* niets */ }
    nav(naar, { replace: true })
    window.scrollTo(0, 0)
  }, [nav])

  /** Platenspeler vrijgeven: open aanvraag afsluiten, sessie wissen, terug naar het rustscherm. */
  const geefVrij = useCallback(async (door: 'bezoeker' | 'inactiviteit' = 'bezoeker') => {
    const s = spelerRef.current
    if (s) await api('/kiosk/speler/vrijgeven', { body: { platenspeler: s.nummer, sessie: s.sessie, door } }).catch(() => {})
    wisSessie('/')
    laadConfig()
  }, [wisSessie, laadConfig])
  kwijtRef.current = () => { wisSessie('/'); toast('Je platenspeler is vrijgegeven. Kies opnieuw een platenspeler om verder te gaan.') }

  // Inactiviteit. Met platenspeler: na N minuten "Ben je er nog?" (vasthouden of vrijgeven), zonder reactie
  // na M minuten automatisch vrijgeven. Zonder platenspeler: na korte tijd terug naar het rustscherm.
  useEffect(() => {
    if (!config) return
    const { inactiviteit_sec, waarschuwing_sec, speler_inactief_min, speler_reactie_min } = config.instellingen
    const tik = () => {
      if (spelerVraagRef.current != null) return // de vraag moet bewust beantwoord worden
      laatste.current = Date.now(); setNogDaar(null); hartslag()
    }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel']
    events.forEach((e) => window.addEventListener(e, tik, { passive: true, capture: true }))
    const i = setInterval(() => {
      if (loc.pathname === '/') return
      const stil = (Date.now() - laatste.current) / 1000
      if (spelerRef.current) {
        const vraag = speler_inactief_min * 60
        const totaal = vraag + speler_reactie_min * 60
        if (stil >= totaal) geefVrij('inactiviteit')
        else if (stil >= vraag) setSpelerVraag(Math.ceil(totaal - stil))
      } else {
        if (stil >= inactiviteit_sec) wisSessie('/')
        else if (stil >= inactiviteit_sec - waarschuwing_sec) setNogDaar(Math.ceil(inactiviteit_sec - stil))
      }
    }, 500)
    return () => { events.forEach((e) => window.removeEventListener(e, tik, { capture: true } as any)); clearInterval(i) }
  }, [config, loc.pathname, wisSessie, geefVrij, hartslag])
  const spelerVraagRef = useRef(spelerVraag)
  spelerVraagRef.current = spelerVraag
  const houdVast = () => { laatste.current = Date.now(); setSpelerVraag(null); hartslag(true) }

  useEffect(() => { laatste.current = Date.now() }, [loc.pathname])

  const ctx = useMemo<Ctx | null>(() => config && {
    config, mand, beschikbaar, versie, toast, wisSessie, speler,
    kiesSpeler: async (nummer) => {
      const r = await api<{ platenspeler: number; sessie: string }>('/kiosk/speler', { body: { platenspeler: nummer } })
      zetSpeler({ nummer: r.platenspeler ?? nummer, sessie: r.sessie })
      laatste.current = Date.now()
      laatsteHartslag.current = Date.now()
      laadConfig()
    },
    vraagVrijgeven: () => setVrijgevenVraag(true),
    spelerKwijt: () => kwijtRef.current(),
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
  }, [config, mand, beschikbaar, versie, toast, wisSessie, speler, laadConfig])

  if (!ctx) return <div className="kiosk"><Laden tekst={onbereikbaar ? 'De Fonotheek is even niet bereikbaar. We proberen het zo opnieuw…' : 'De Fonotheek wordt geladen…'} /></div>

  return (
    <KioskCtx.Provider value={ctx}>
      <div className="kiosk">
        {/* Eerst een platenspeler kiezen; zonder speler zijn alleen het rustscherm en de keuze bereikbaar. */}
        {!speler ? (
          <Routes>
            <Route path="/" element={<Rust />} />
            <Route path="/speler" element={<SpelerKiezen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<Rust />} />
            <Route path="/speler" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<Home />} />
            <Route path="/zoeken" element={<Zoeken />} />
            <Route path="/album/:id" element={<Album />} />
            <Route path="/artiest/:naam" element={<Artiest />} />
            <Route path="/aanvraag" element={<Aanvraag />} />
            <Route path="/verstuurd" element={<Verstuurd />} />
            <Route path="/lezen" element={<Lezen />} />
            <Route path="*" element={<Home />} />
          </Routes>
        )}
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
        {spelerVraag != null && speler && (
          <div className="modal-achter" role="alertdialog" aria-labelledby="spelervraag">
            <div className="card modal">
              <div className="aftellen" aria-live="polite">{Math.floor(spelerVraag / 60)}:{String(spelerVraag % 60).padStart(2, '0')}</div>
              <h2 id="spelervraag">Ben je er nog?</h2>
              <p>Je hebt de app een tijdje niet gebruikt. Wil je platenspeler {speler.nummer} vasthouden of vrijgeven? Zonder antwoord wordt de speler automatisch vrijgegeven.</p>
              <div className="knoppen">
                <button className="btn btn-pink btn-l" onClick={houdVast}>Platenspeler vasthouden</button>
                <button className="btn btn-ghost btn-l" onClick={() => geefVrij('bezoeker')}>Platenspeler vrijgeven</button>
              </div>
            </div>
          </div>
        )}
        {vrijgevenVraag && speler && (
          <div className="modal-achter" role="alertdialog" aria-labelledby="vrijgeven">
            <div className="card modal">
              <h2 id="vrijgeven">Platenspeler {speler.nummer} vrijgeven?</h2>
              <p>Klaar met luisteren? Laat je platen bij de speler liggen; een medewerker haalt ze op. Je aanvraaglijst wordt gewist.</p>
              <div className="knoppen">
                <button className="btn btn-pink btn-l" onClick={() => geefVrij('bezoeker')}>Ja, vrijgeven</button>
                <button className="btn btn-ghost btn-l" onClick={() => setVrijgevenVraag(false)}>Nee, ik luister nog</button>
              </div>
            </div>
          </div>
        )}
        {melding && <div className="toast" role="status">{melding}</div>}
      </div>
    </KioskCtx.Provider>
  )
}
