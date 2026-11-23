// E-mail via Resend (14). Zonder RESEND_API_KEY wordt er niets verstuurd (alleen het onderwerp in het serverlog).
import { haal } from './naarbuiten.ts'
const AFZENDER = process.env.FONOS_MAIL_AFZENDER ?? 'Luisterbar <fonotheek@fonos.nl>'

export async function stuurMail(aan: string | string[], onderwerp: string, tekst: string): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    // De inhoud niet loggen: daar kan een resetlink in staan (securityreview R3).
    console.log(`[mail] (geen RESEND_API_KEY) niet verstuurd: "${onderwerp}" aan ${[aan].flat().length} ontvanger(s)`)
    return
  }
  const r = await haal('mail', 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: AFZENDER, to: [aan].flat(), subject: onderwerp, text: tekst }),
  })
  if (!r.ok) throw new Error(`Mail versturen mislukt: ${r.status} ${(await r.text()).slice(0, 300)}`)
}
