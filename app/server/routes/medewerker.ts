// API voor het medewerkersscherm (9). Rol: medewerker (of beheerder).
import { Hono } from 'hono'
import { vereist, wie } from '../auth.ts'
import { instellingen, run, get } from '../db.ts'
import { log } from '../log.ts'
import { AanvraagFout, aanvraagDetail, annuleren, lijstAanvragen, minutenOpen, ophalen, platenspelers, uitgeven, verwijderItem, vrijgeven } from '../aanvragen.ts'
import { aanvragenGewijzigd, beschikbaarheidGewijzigd } from '../events.ts'

export const medewerker = new Hono()
medewerker.use('*', vereist('medewerker', 'beheerder'))

medewerker.get('/aanvragen', (c) => {
  const tab = c.req.query('tab') === 'afgerond' ? 'afgerond' : 'actief'
  const inst = instellingen()
  const lijst = lijstAanvragen(tab).map((a) => ({ ...a, lang_open: a.status === 'ingediend' && minutenOpen(a) >= inst.markering_min }))
  return c.json({ aanvragen: lijst, actief: tab === 'actief' ? lijst.length : lijstAanvragen('actief').length, markering_min: inst.markering_min, geluid: inst.geluid_aan })
})

medewerker.get('/aanvraag/:id', (c) => {
  const a = aanvraagDetail(Number(c.req.param('id')))
  return a ? c.json(a) : c.json({ fout: 'Aanvraag niet gevonden' }, 404)
})

const actie = (fn: (id: number, body: any, c: any) => void) => async (c: any) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    fn(Number(c.req.param('id')), body, c)
    return c.json(aanvraagDetail(Number(c.req.param('id'))))
  } catch (e) {
    if (e instanceof AanvraagFout) return c.json({ fout: e.message }, 409)
    throw e
  }
}

medewerker.post('/aanvraag/:id/ophalen', actie((id, _b, c) => ophalen(id, wie(c))))
medewerker.post('/aanvraag/:id/uitgeven', actie((id, _b, c) => uitgeven(id, wie(c))))
medewerker.post('/aanvraag/:id/vrijgeven', actie((id, _b, c) => vrijgeven(id, wie(c))))
medewerker.post('/aanvraag/:id/annuleren', actie((id, b, c) => annuleren(id, b.reden?.trim() || null, wie(c))))
medewerker.post('/aanvraag/:id/item/:item/verwijder', actie((id, b, c) => verwijderItem(id, Number(c.req.param('item')), b.reden?.trim() || null, wie(c))))

medewerker.get('/platenspelers', (c) => c.json(platenspelers()))
medewerker.post('/platenspeler/:nr', async (c) => {
  const nr = Number(c.req.param('nr'))
  const { actief } = await c.req.json<{ actief: boolean }>()
  const p = get<any>('SELECT * FROM platenspelers WHERE nummer = ?', nr)
  if (!p) return c.json({ fout: 'Onbekende platenspeler' }, 404)
  run('UPDATE platenspelers SET actief = ? WHERE nummer = ?', actief ? 1 : 0, nr)
  log(wie(c), actief ? 'platenspeler geactiveerd' : 'platenspeler op inactief gezet', { type: 'platenspeler', id: nr, label: `Platenspeler ${nr}`, veld: 'actief', oud: !!p.actief, nieuw: !!actief })
  aanvragenGewijzigd()
  beschikbaarheidGewijzigd()
  return c.json(platenspelers())
})
