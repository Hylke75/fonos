// Pushmeldingen voor medewerkers (verbetering 9): ook als het scherm vergrendeld is of een ander tabblad openstaat.
// Sleutels: VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY uit de omgeving; anders eenmalig gemaakt en bewaard in de tabel geheimen.
import webpush from 'web-push'
import { all, get, run } from './db.ts'

let sleutels: { publicKey: string; privateKey: string } | null = null

export async function vapid() {
  if (sleutels) return sleutels
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    sleutels = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  } else {
    const r = await get<{ waarde: string }>("SELECT waarde FROM geheimen WHERE naam = 'vapid'")
    if (r) sleutels = JSON.parse(r.waarde)
    else {
      const k = webpush.generateVAPIDKeys()
      await run("INSERT INTO geheimen (naam, waarde) VALUES ('vapid', ?) ON CONFLICT (naam) DO NOTHING", JSON.stringify(k))
      sleutels = JSON.parse((await get<{ waarde: string }>("SELECT waarde FROM geheimen WHERE naam = 'vapid'"))!.waarde)
    }
  }
  webpush.setVapidDetails(`mailto:${process.env.FONOS_BEHEERDER_EMAIL ?? 'fonotheek@beeldengeluid.nl'}`, sleutels!.publicKey, sleutels!.privateKey)
  return sleutels!
}

export type Abonnement = { endpoint: string; keys: { p256dh: string; auth: string } }

export async function abonneer(gebruikerId: number, a: Abonnement, apparaat?: string | null) {
  if (!a?.endpoint?.startsWith('https://') || !a.keys?.p256dh || !a.keys?.auth) throw new Error('Ongeldig abonnement')
  await run(`INSERT INTO push_abonnementen (gebruiker_id, endpoint, sleutels, apparaat) VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET gebruiker_id = excluded.gebruiker_id, sleutels = excluded.sleutels, apparaat = excluded.apparaat`,
    gebruikerId, a.endpoint, JSON.stringify(a.keys), apparaat?.slice(0, 200) ?? null)
}

export const afmelden = (endpoint: string) => run('DELETE FROM push_abonnementen WHERE endpoint = ?', endpoint)

/** Stuurt een melding naar alle actieve medewerkers; verlopen abonnementen worden opgeruimd. Faalt nooit, hooguit 4 s. */
export async function stuurPush(bericht: { titel: string; tekst: string; url?: string; tag?: string }) {
  try {
    const subs = await all<any>(`SELECT p.* FROM push_abonnementen p JOIN gebruikers g ON g.id = p.gebruiker_id
      WHERE g.actief = 1 AND (g.rollen LIKE '%medewerker%' OR g.rollen LIKE '%beheerder%')`)
    if (!subs.length) return 0
    await vapid()
    const payload = JSON.stringify(bericht)
    const klaar = Promise.allSettled(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.sleutels) }, payload, { TTL: 600, urgency: 'high' })
        await run('UPDATE push_abonnementen SET laatst_gebruikt = nu() WHERE id = ?', s.id)
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await run('DELETE FROM push_abonnementen WHERE id = ?', s.id)
        else console.error('[push] versturen mislukt', e?.statusCode ?? e?.message)
      }
    }))
    await Promise.race([klaar, new Promise((r) => setTimeout(r, 4000))])
    return subs.length
  } catch (e) {
    console.error('[push]', e)
    return 0
  }
}
