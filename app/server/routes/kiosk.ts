// API voor de bezoekersapp. Geen login: alleen lezen van de catalogus en aanvragen aanmaken (13).
import { Hono } from 'hono'
import { album, artiest, beschikbaarheid, home, kioskConfig, ookLuisteren, verrasMe, zoekCatalogus } from '../catalogus.ts'
import { meldAan as wachtAan, meldAf as wachtAf, wachtStatus } from '../wachtlijst.ts'
import { stuurPush } from '../push.ts'
const bestelnrTekst = (n: number) => `#${String(n).padStart(3, '0')}`
import { suggesties } from '../zoeken.ts'
import { AanvraagFout, aanvraagVanSessie, dienAanvraagIn, geefSpelerVrij, houdSpelerVast, kiesSpeler } from '../aanvragen.ts'
import { BEZOEKER } from '../log.ts'
import { EMAIL_RE, meldAan } from '../nieuwsbrief.ts'

export const kiosk = new Hono()

/** De bezoeker in het log, met de naam van de tablet als die bekend is (verbetering 19). */
const bezoeker = (c: any) => {
  let t = ''
  try { t = decodeURIComponent(c.req.header('x-fonos-tablet') ?? '') } catch { /* niets */ }
  return t ? { ...BEZOEKER, naam: `${BEZOEKER.naam} (${t.slice(0, 60)})` } : BEZOEKER
}

const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined)

kiosk.get('/config', async (c) => c.json(await kioskConfig()))
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
    // Pushmelding naar de medewerkers (verbetering 9).
    await stuurPush({ titel: `Nieuwe aanvraag ${bestelnrTekst(r.bestelnummer)}`, tekst: `Platenspeler ${r.platenspeler} · ${body.titels?.length ?? 0} ${body.titels?.length === 1 ? 'titel' : 'titels'}`, url: '/medewerker', tag: `aanvraag-${r.bestelnummer}` })
    return c.json({ bestelnummer: r.bestelnummer, platenspeler: r.platenspeler })
  } catch (e) {
    if (e instanceof AanvraagFout) return c.json({ fout: e.message, code: e.code, ...e.extra }, 409)
    throw e
  }
})

// Platenspeler kiezen (eerste stap), vasthouden tijdens gebruik en vrijgeven na gebruik.
kiosk.post('/speler', async (c) => {
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
  const tablet = (() => { try { return decodeURIComponent(c.req.header('x-fonos-tablet') ?? '') || null } catch { return null } })()
  return c.json(await wachtAan(tablet))
})
kiosk.get('/wachtlijst/:token', async (c) => c.json(await wachtStatus(c.req.param('token'))))
kiosk.delete('/wachtlijst/:token', async (c) => { await wachtAf(c.req.param('token')); return c.json({ ok: true }) })

kiosk.post('/nieuwsbrief', async (c) => {
  const { email, naam } = await c.req.json<{ email: string; naam?: string }>()
  if (!email || !EMAIL_RE.test(email.trim())) return c.json({ fout: 'Vul een geldig e-mailadres in.' }, 400)
  // Niet opslaan: direct doorsturen naar het nieuwsbriefsysteem (11).
  const status = await meldAan({ email: email.trim(), naam: naam?.trim() || null })
  return c.json({ status })
})
