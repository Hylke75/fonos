// Realtime via polling: elke paar seconden de tellers ophalen; bij een verandering de callback aanroepen.
import { useEffect, useRef } from 'react'

export type Versies = { aanvragen: number; beschikbaarheid: number; catalogus: number; laatste_nieuw?: number | null }

export function useVersies(opWijziging: (nieuw: Versies, oud: Versies) => void, intervalMs = 4000) {
  const ref = useRef(opWijziging)
  ref.current = opWijziging
  useEffect(() => {
    let vorige: Versies | null = null
    let stop = false
    let t: any
    const tik = async () => {
      try {
        const r = await fetch('/api/versies', { credentials: 'same-origin', cache: 'no-store' })
        if (r.ok) {
          const v: Versies = await r.json()
          if (vorige && (v.aanvragen !== vorige.aanvragen || v.beschikbaarheid !== vorige.beschikbaarheid || v.catalogus !== vorige.catalogus)) ref.current(v, vorige)
          vorige = v
        }
      } catch { /* even geen verbinding: volgende keer opnieuw */ }
      // Niet verversen als het scherm verborgen is.
      if (!stop) t = setTimeout(tik, document.hidden ? intervalMs * 4 : intervalMs)
    }
    tik()
    return () => { stop = true; clearTimeout(t) }
  }, [intervalMs])
}
