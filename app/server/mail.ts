// E-mail via Resend (14). Zonder RESEND_API_KEY wordt de mail alleen in het serverlog gezet.
const AFZENDER = process.env.FONOS_MAIL_AFZENDER ?? 'Fonotheek <fonotheek@fonos.nl>'

export async function stuurMail(aan: string | string[], onderwerp: string, tekst: string): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.log(`[mail] (geen RESEND_API_KEY) aan ${[aan].flat().join(', ')}: ${onderwerp}\n${tekst}`)
    return
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: AFZENDER, to: [aan].flat(), subject: onderwerp, text: tekst }),
  })
  if (!r.ok) throw new Error(`Mail versturen mislukt: ${r.status} ${await r.text()}`)
}
