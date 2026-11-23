// Rem op misbruik (securityreview kandidaat 7): hoeveel verzoeken per sleutel (e-mailadres, IP, kiosk) per tijdvak.
// In de database, zodat de rem voor alle serverinstanties samen geldt (op Vercel draaien er meerdere tegelijk).
import { get, run } from './db.ts'

/** Telt één verzoek mee. true = toegestaan, false = boven het maximum in dit tijdvak. */
export async function rem(sleutel: string, max: number, minuten: number): Promise<boolean> {
  const duur = minuten * 60_000
  const venster = new Date(Math.floor(Date.now() / duur) * duur).toISOString()
  const r = await get<{ n: number }>(`INSERT INTO remmen (sleutel, venster, n) VALUES (?, ?, 1)
    ON CONFLICT (sleutel) DO UPDATE SET n = CASE WHEN remmen.venster = excluded.venster THEN remmen.n + 1 ELSE 1 END, venster = excluded.venster
    RETURNING n`, sleutel.slice(0, 200), venster)
  if (Math.random() < 0.01) await run('DELETE FROM remmen WHERE venster < ?', new Date(Date.now() - 86_400_000).toISOString()).catch(() => {})
  return (r?.n ?? 0) <= max
}
