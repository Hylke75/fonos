// Kapotte hoezen opsporen (verbetering 14). Elke nacht een deel van de titels; na ongeveer een maand is alles gecontroleerd.
// Muziekweb (media.cdr.nl) geeft voor een ontbrekende hoes geen 404 maar een vervangend GIF-plaatje: dat telt ook als kapot.
import { all, run } from './db.ts'

async function controleer(url: string): Promise<boolean | null> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 8000)
  try {
    const r = await fetch(url.replace(/^http:\/\/media\.cdr\.nl\//, 'https://media.cdr.nl/'), { method: 'HEAD', signal: ac.signal, redirect: 'follow' })
    if (r.status === 404 || r.status === 410) return false
    if (!r.ok) return r.status === 403 ? false : null // 403 = bestaat niet (meer); andere fouten: later opnieuw
    const type = r.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return false
    if (/media\.cdr\.nl/.test(url) && type === 'image/gif') return false
    return true
  } catch { return null } finally { clearTimeout(t) }
}

/** Controleert de n titels die het langst niet gecontroleerd zijn. Geeft het aantal kapotte terug. */
export async function controleerHoezen(n = 1500, tegelijk = 16) {
  const rijen = await all<{ id: number; d_hoes: string }>(`SELECT id, d_hoes FROM titels WHERE d_hoes LIKE 'http%'
    ORDER BY hoes_gecontroleerd_op NULLS FIRST, id LIMIT ?`, n)
  let kapot = 0, i = 0
  await Promise.all(Array.from({ length: tegelijk }, async () => {
    while (i < rijen.length) {
      const r = rijen[i++]
      const ok = await controleer(r.d_hoes)
      if (ok === null) continue
      if (!ok) kapot++
      await run('UPDATE titels SET hoes_kapot = ?, hoes_gecontroleerd_op = nu() WHERE id = ?', ok ? 0 : 1, r.id)
    }
  }))
  return { gecontroleerd: rijen.length, kapot }
}
