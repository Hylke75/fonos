// API voor de bezoekersapp. Geen login. Lezen mag iedereen; spelers kiezen, aanvragen, wachtlijst en nieuwsbrief alleen
// een gekoppelde kiosktablet (of een ingelogde medewerker). Dat regelt toegang.ts; zie REGELS daar.
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { COOKIE, gebruikerBijToken } from '../auth.ts'
import { gebruiker, kiosk as kioskVan, KIOSK_COOKIE, kioskBijToken, koppel } from '../toegang.ts'
import { rem } from '../rem.ts'
import { clientIp } from '../verzoek.ts'
import { GebruikersFout } from '../fouten.ts'
import { album, artiest, beschikbaarheid, home, keuzehulp, kioskConfig, ookLuisteren, verrasMe, zoekCatalogus } from '../catalogus.ts'
import { meldAan as wachtAan, meldAf as wachtAf, wachtStatus } from '../wachtlijst.ts'
import { stuurPush } from '../push.ts'
const bestelnrTekst = (n: number) => `#${String(n).padStart(3, '0')}`
import { suggesties } from '../zoeken.ts'
import { AanvraagFout, aanvraagVanSessie, dienAanvraagIn, geefSpelerVrij, houdSpelerVast, kiesSpeler } from '../aanvragen.ts'
import { BEZOEKER } from '../log.ts'
import { EMAIL_RE, meldAan } from '../nieuwsbrief.ts'

export const kiosk = new Hono()

/** De bezoeker in het log, met de naam van de gekoppelde tablet (verbetering 19). De naam komt uit de koppeling,
 *  niet uit een header die iedereen kan invullen. */
const bezoeker = (c: Context) => {
  const t = kioskVan(c)?.naam ?? (gebruiker(c) ? `via ${gebruiker(c)!.naam}` : '')
  return t ? { ...BEZOEKER, naam: `${BEZOEKER.naam} (${t})` } : BEZOEKER
}

/** Rem per kiosk (of per ingelogde gebruiker): een tablet die op hol slaat, kan de bar niet platleggen. */
async function remKiosk(c: Context, soort: string, max: number, minuten: number) {
  const wie = kioskVan(c)?.naam ?? `gebruiker:${gebruiker(c)?.id}`
  if (!(await rem(`${soort}:${wie}`, max, minuten))) throw new GebruikersFout('Even rustig aan: probeer het over een paar minuten opnieuw.', 429)
}

const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined)

kiosk.get('/config', async (c) => {
  // Is deze tablet gekoppeld (of is er een medewerker ingelogd)? Zo niet, dan vraagt de kiosk om een koppelcode.
  const k = await kioskBijToken(getCookie(c, KIOSK_COOKIE))
  const gekoppeld = !!k || !!(await gebruikerBijToken(getCookie(c, COOKIE)))
  return c.json({ ...(await kioskConfig()), gekoppeld, kiosk_naam: k?.naam ?? null })
})

/** Een tablet koppelen met de eenmalige code uit Beheer → Status. Met een rem tegen raden. */
kiosk.post('/koppelen', async (c) => {
  if (!(await rem(`koppelen:${clientIp(c) ?? 'onbekend'}`, 10, 15))) return c.json({ fout: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' }, 429)
  const { code } = await c.req.json<{ code: string }>()
  const naam = await koppel(c, String(code ?? ''))
  return naam ? c.json({ naam }) : c.json({ fout: 'Deze code klopt niet of is verlopen. Vraag een nieuwe code in Beheer → Status.' }, 400)
})
kiosk.get('/home', async (c) => c.json(await home()))
kiosk.get('/suggesties', async (c) => c.json(await suggesties(c.req.query('q') ?? '')))

kiosk.get('/zoek', async (c) => {
  const q = c.req.query()
  return c.json(await zoekCatalogus({
    q: q.q, knop: num(q.knop), sub: q.sub || undefined, drager: q.drager || undefined, decennium: num(q.decennium), jaar: num(q.jaar),
    nl: q.nl === '1', beschikbaar: q.beschikbaar === '1', selectie: num(q.selectie), sort: (q.sort as any) || undefined, pagina: num(q.pagina), per: num(q.per),
  }))
})

kiosk.get('/titel/:id', async (c) => {
  const a = await album(Number(c.req.param('id')))
  return a ? c.json(a) : c.json({ fout: 'Deze titel is niet (meer) beschikbaar.' }, 404)
})

kiosk.get('/titel/:id/ook', async (c) => c.json(await ookLuisteren(Number(c.req.param('id')))))

kiosk.get('/artiest', async (c) => c.json(await artiest(c.req.query('naam') ?? '')))

kiosk.get('/verras', async (c) => {
  const id = await verrasMe(num(c.req.query('knop')))
  return id ? c.json({ id }) : c.json({ fout: 'Geen titel gevonden' }, 404)
})

kiosk.post('/keuzehulp', async (c) => {
  const b = await c.req.json<{ voorkeur?: number[]; decennium?: number | null; durf?: number; eerder?: number[]; speler?: string }>().catch(() => ({} as any))
  const r = await keuzehulp({ voorkeur: (b.voorkeur ?? []).map(Number).filter(Number.isFinite).slice(0, 30), decennium: b.decennium ?? null, durf: Number(b.durf ?? 0), eerder: (b.eerder ?? []).map(Number).filter(Number.isFinite).slice(0, 50), speler: b.speler === 'cd' ? 'cd' : b.speler === 'lp' ? 'lp' : null })
  return r ? c.json(r) : c.json({ fout: 'Geen plaat gevonden' }, 404)
})

kiosk.post('/beschikbaarheid', async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>()
  return c.json(await beschikbaarheid((ids ?? []).map(Number).slice(0, 50)))
})

kiosk.post('/aanvraag', async (c) => {
  await remKiosk(c, 'aanvraag', 30, 10)
  const body = await c.req.json<any>()
  try {
    const r = await dienAanvraagIn({
      platenspeler: Number(body.platenspeler),
      sessie: typeof body.sessie === 'string' ? body.sessie : null,
      titels: (body.titels ?? []).map((t: any) => ({ titel_id: Number(t.titel_id), exemplaar_id: t.exemplaar_id ? Number(t.exemplaar_id) : null })),
      bezetAfsluiten: !!body.bezetAfsluiten,
    })
    // Pushmelding naar de medewerkers (verbetering 9).
    await stuurPush({ titel: `Nieuwe aanvraag ${bestelnrTekst(r.bestelnummer)}`, tekst: `Draaitafel ${r.platenspeler} · ${body.titels?.length ?? 0} ${body.titels?.length === 1 ? 'titel' : 'titels'}`, url: '/medewerker', tag: `aanvraag-${r.bestelnummer}` })
    return c.json({ bestelnummer: r.bestelnummer, platenspeler: r.platenspeler })
  } catch (e) {
    if (e instanceof AanvraagFout) return c.json({ fout: e.message, code: e.code, ...e.extra }, 409)
    throw e
  }
})

// Platenspeler kiezen (eerste stap), vasthouden tijdens gebruik en vrijgeven na gebruik.
kiosk.post('/speler', async (c) => {
  await remKiosk(c, 'speler', 60, 10)
  const { platenspeler, wachtlijst } = await c.req.json<{ platenspeler: number; wachtlijst?: string }>()
  try {
    return c.json({ platenspeler: Number(platenspeler), sessie: await kiesSpeler(Number(platenspeler), bezoeker(c), wachtlijst ? String(wachtlijst) : null) })
  } catch (e) {
    if (e instanceof AanvraagFout) return c.json({ fout: e.message, code: e.code }, 409)
    throw e
  }
})
kiosk.post('/speler/vasthouden', async (c) => {
  const { platenspeler, sessie, alleen_status } = await c.req.json<{ platenspeler: number; sessie: string; alleen_status?: boolean }>()
  // alleen_status: de kiosk vraagt alleen de status van de aanvraag op, zonder de speler "actief" te maken.
  const ok = alleen_status ? !!(await aanvraagVanSessie(Number(platenspeler), String(sessie ?? ''))) : await houdSpelerVast(Number(platenspeler), String(sessie ?? ''))
  if (!ok) return c.json({ ok: false })
  return c.json({ ok: true, ...(await aanvraagVanSessie(Number(platenspeler), String(sessie ?? ''))) })
})
kiosk.post('/speler/vrijgeven', async (c) => {
  const { platenspeler, sessie, door } = await c.req.json<{ platenspeler: number; sessie: string; door?: string }>()
  return c.json({ ok: await geefSpelerVrij(Number(platenspeler), door === 'inactiviteit' ? 'inactiviteit' : 'bezoeker', bezoeker(c), String(sessie ?? '')) })
})

// Wachtlijst als alle platenspelers bezet zijn (verbetering 8).
kiosk.post('/wachtlijst', async (c) => {
  await remKiosk(c, 'wachtlijst', 30, 10)
  return c.json(await wachtAan(kioskVan(c)?.naam ?? null))
})
kiosk.get('/wachtlijst/:token', async (c) => c.json(await wachtStatus(c.req.param('token'))))
kiosk.delete('/wachtlijst/:token', async (c) => { await wachtAf(c.req.param('token')); return c.json({ ok: true }) })

kiosk.post('/nieuwsbrief', async (c) => {
  await remKiosk(c, 'nieuwsbrief', 20, 60)
  const { email, naam } = await c.req.json<{ email: string; naam?: string }>()
  if (!email || !EMAIL_RE.test(email.trim())) return c.json({ fout: 'Vul een geldig e-mailadres in.' }, 400)
  // Niet opslaan: direct doorsturen naar het nieuwsbriefsysteem (11).
  const status = await meldAan({ email: email.trim(), naam: naam?.trim() || null })
  return c.json({ status })
})
