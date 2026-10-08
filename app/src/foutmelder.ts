// Fouten uit de browser naar de server sturen (verbetering 20): een kiosk die stilletjes hapert, zie je dan ook.
// Hooguit 5 meldingen per keer laden, en elke fout maar één keer.
import { tabletKop } from './api'

let aantal = 0
const gezien = new Set<string>()

function stuur(bericht: string, bron?: string, stack?: string) {
  if (!bericht || aantal >= 5 || gezien.has(bericht)) return
  // Fouten van browserextensies en afgebroken laadacties niet melden.
  if (/ResizeObserver loop|chrome-extension:|AbortError|Load failed|NetworkError/i.test(`${bericht} ${bron ?? ''}`)) return
  gezien.add(bericht)
  aantal++
  try {
    fetch('/api/fout', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...tabletKop() },
      body: JSON.stringify({ bericht, bron, stack: stack?.slice(0, 3000), pagina: location.pathname }),
    }).catch(() => {})
  } catch { /* niets */ }
}

export function startFoutmelder() {
  window.addEventListener('error', (e) => stuur(e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined, e.error?.stack))
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = e.reason
    stuur(String(r?.message ?? r ?? 'Onbekende fout'), 'unhandledrejection', r?.stack)
  })
}
