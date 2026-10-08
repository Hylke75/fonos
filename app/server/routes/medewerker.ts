// API voor het medewerkersscherm (9). Rol: medewerker (of beheerder).
import { Hono } from 'hono'
import { vereist, wie } from '../auth.ts'
import { instellingen, run, get } from '../db.ts'
import { log } from '../log.ts'
import { AanvraagFout, aanvraagDetail, geefSpelerVrij, looplijst, terugTeZetten, vandaagOverzicht, zetTerugInArchief, annuleren, lijstAanvragen, minutenOpen, ophalen, platenspelers, uitgeven, verwijderItem, vrijgeven } from '../aanvragen.ts'
import { aanvragenGewijzigd, beschikbaarheidGewijzigd } from '../events.ts'
import { abonneer, afmelden, stuurPush, vapid, type Abonnement } from '../push.ts'

export const medewerker = new Hono()
medewerker.use('*', vereist('medewerker', 'beheerder'))

// Pushmeldingen op dit apparaat (verbetering 9).
medewerker.get('/push/sleutel', async (c) => c.json({ publicKey: (await vapid()).publicKey }))
medewerker.post('/push', async (c) => {
  const { abonnement } = await c.req.json<{ abonnement: Abonnement }>()
  try { await abonneer(wie(c).id!, abonnement, c.req.header('user-agent')) } catch (e: any) { return c.json({ fout: e.message }, 400) }
  await log(wie(c), 'pushmeldingen aangezet', { type: 'gebruiker', id: wie(c).id, label: wie(c).naam })
  return c.json({ ok: true })
})
medewerker.post('/push/uit', async (c) => {
  const { endpoint } = await c.req.json<{ endpoint: string }>()
  await afmelden(String(endpoint ?? ''))
  return c.json({ ok: true })
})
medewerker.post('/push/test', async (c) => c.json({ verstuurd: await stuurPush({ titel: 'Fonotheek', tekst: 'Pushmeldingen staan aan op dit apparaat.', url: '/medewerker', tag: 'test' }) }))

medewerker.get('/aanvragen', async (c) => {
  const tab = c.req.query('tab') === 'afgerond' ? 'afgerond' : 'actief'
  const inst = await instellingen()
  const lijst = (await lijstAanvragen(tab)).map((a) => ({ ...a, lang_open: a.status === 'ingediend' && minutenOpen(a) >= inst.markering_min }))
  return c.json({ aanvragen: lijst, actief: tab === 'actief' ? lijst.length : (await lijstAanvragen('actief')).length, markering_min: inst.markering_min, geluid: inst.geluid_aan })
})

medewerker.get('/aanvraag/:id', async (c) => {
  const a = await aanvraagDetail(Number(c.req.param('id')))
  return a ? c.json(a) : c.json({ fout: 'Aanvraag niet gevonden' }, 404)
})

const actie = (fn: (id: number, body: any, c: any) => Promise<void>) => async (c: any) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    await fn(Number(c.req.param('id')), body, c)
    return c.json(await aanvraagDetail(Number(c.req.param('id'))))
  } catch (e) {
    if (e instanceof AanvraagFout) return c.json({ fout: e.message }, 409)
    throw e
  }
}

medewerker.post('/aanvraag/:id/ophalen', actie(async (id, _b, c) => await ophalen(id, wie(c))))
medewerker.post('/aanvraag/:id/uitgeven', actie(async (id, _b, c) => await uitgeven(id, wie(c))))
medewerker.post('/aanvraag/:id/vrijgeven', actie(async (id, _b, c) => await vrijgeven(id, wie(c))))
medewerker.post('/aanvraag/:id/annuleren', actie(async (id, b, c) => await annuleren(id, b.reden?.trim() || null, wie(c))))
medewerker.post('/aanvraag/:id/item/:item/verwijder', actie(async (id, b, c) => await verwijderItem(id, Number(c.req.param('item')), b.reden?.trim() || null, wie(c))))

medewerker.get('/platenspelers', async (c) => c.json(await platenspelers()))
medewerker.get('/looplijst', async (c) => c.json(await looplijst()))
medewerker.get('/terugzetten', async (c) => c.json(await terugTeZetten()))
medewerker.post('/terugzetten', async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>()
  await zetTerugInArchief(ids ?? [], wie(c))
  return c.json(await terugTeZetten())
})
medewerker.get('/vandaag', async (c) => c.json(await vandaagOverzicht()))
medewerker.post('/platenspeler/:nr/vrijgeven', async (c) => {
  await geefSpelerVrij(Number(c.req.param('nr')), 'medewerker', wie(c))
  return c.json(await platenspelers())
})
medewerker.post('/platenspeler/:nr', async (c) => {
  const nr = Number(c.req.param('nr'))
  const { actief } = await c.req.json<{ actief: boolean }>()
  const p = await get<any>('SELECT * FROM platenspelers WHERE nummer = ?', nr)
  if (!p) return c.json({ fout: 'Onbekende platenspeler' }, 404)
  await run('UPDATE platenspelers SET actief = ? WHERE nummer = ?', actief ? 1 : 0, nr)
  await log(wie(c), actief ? 'platenspeler geactiveerd' : 'platenspeler op inactief gezet', { type: 'platenspeler', id: nr, label: `Platenspeler ${nr}`, veld: 'actief', oud: !!p.actief, nieuw: !!actief })
  await aanvragenGewijzigd()
  await beschikbaarheidGewijzigd()
  return c.json(await platenspelers())
})
