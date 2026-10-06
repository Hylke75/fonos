// API voor de bezoekersapp. Geen login: alleen lezen van de catalogus en aanvragen aanmaken (13).
import { Hono } from 'hono'
import { album, artiest, beschikbaarheid, home, kioskConfig, verrasMe, zoekCatalogus } from '../catalogus.ts'
import { suggesties } from '../zoeken.ts'
import { AanvraagFout, dienAanvraagIn, geefSpelerVrij, houdSpelerVast, kiesSpeler } from '../aanvragen.ts'
import { BEZOEKER } from '../log.ts'
import { EMAIL_RE, meldAan } from '../nieuwsbrief.ts'

export const kiosk = new Hono()

const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined)

kiosk.get('/config', async (c) => c.json(await kioskConfig()))
kiosk.get('/home', async (c) => c.json(await home()))
kiosk.get('/suggesties', async (c) => c.json(await suggesties(c.req.query('q') ?? '')))

kiosk.get('/zoek', async (c) => {
  const q = c.req.query()
  return c.json(await zoekCatalogus({
    q: q.q, knop: num(q.knop), sub: q.sub || undefined, drager: q.drager || undefined, decennium: num(q.decennium), jaar: num(q.jaar),
    nl: q.nl === '1', selectie: num(q.selectie), sort: (q.sort as any) || undefined, pagina: num(q.pagina), per: num(q.per),
  }))
})

kiosk.get('/titel/:id', async (c) => {
  const a = await album(Number(c.req.param('id')))
  return a ? c.json(a) : c.json({ fout: 'Deze titel is niet (meer) beschikbaar.' }, 404)
})

kiosk.get('/artiest', async (c) => c.json(await artiest(c.req.query('naam') ?? '')))

kiosk.get('/verras', async (c) => {
  const id = await verrasMe(num(c.req.query('knop')))
  return id ? c.json({ id }) : c.json({ fout: 'Geen titel gevonden' }, 404)
})

kiosk.post('/beschikbaarheid', async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>()
  return c.json(await beschikbaarheid((ids ?? []).map(Number).slice(0, 50)))
})

kiosk.post('/aanvraag', async (c) => {
  const body = await c.req.json<any>()
  try {
    const r = await dienAanvraagIn({
      platenspeler: Number(body.platenspeler),
      sessie: typeof body.sessie === 'string' ? body.sessie : null,
      titels: (body.titels ?? []).map((t: any) => ({ titel_id: Number(t.titel_id), exemplaar_id: t.exemplaar_id ? Number(t.exemplaar_id) : null })),
      bezetAfsluiten: !!body.bezetAfsluiten,
    })
    return c.json({ bestelnummer: r.bestelnummer, platenspeler: r.platenspeler })
  } catch (e) {
    if (e instanceof AanvraagFout) return c.json({ fout: e.message, code: e.code, ...e.extra }, 409)
    throw e
  }
})

// Platenspeler kiezen (eerste stap), vasthouden tijdens gebruik en vrijgeven na gebruik.
kiosk.post('/speler', async (c) => {
  const { platenspeler } = await c.req.json<{ platenspeler: number }>()
  try {
    return c.json({ platenspeler: Number(platenspeler), sessie: await kiesSpeler(Number(platenspeler)) })
  } catch (e) {
    if (e instanceof AanvraagFout) return c.json({ fout: e.message, code: e.code }, 409)
    throw e
  }
})
kiosk.post('/speler/vasthouden', async (c) => {
  const { platenspeler, sessie } = await c.req.json<{ platenspeler: number; sessie: string }>()
  return c.json({ ok: await houdSpelerVast(Number(platenspeler), String(sessie ?? '')) })
})
kiosk.post('/speler/vrijgeven', async (c) => {
  const { platenspeler, sessie, door } = await c.req.json<{ platenspeler: number; sessie: string; door?: string }>()
  return c.json({ ok: await geefSpelerVrij(Number(platenspeler), door === 'inactiviteit' ? 'inactiviteit' : 'bezoeker', BEZOEKER, String(sessie ?? '')) })
})

kiosk.post('/nieuwsbrief', async (c) => {
  const { email, naam } = await c.req.json<{ email: string; naam?: string }>()
  if (!email || !EMAIL_RE.test(email.trim())) return c.json({ fout: 'Vul een geldig e-mailadres in.' }, 400)
  // Niet opslaan: direct doorsturen naar het nieuwsbriefsysteem (11).
  const status = await meldAan({ email: email.trim(), naam: naam?.trim() || null })
  return c.json({ status })
})
