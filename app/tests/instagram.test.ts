// Instagram-account van Fonos: alleen een instagram.com-adres, en de kiosk krijgt het mee voor de QR-code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL

const { useMemoryDb, zetInstelling } = await import('../server/db.ts')
const { maakGebruiker } = await import('../server/auth.ts')
const { app } = await import('../server/app.ts')
await useMemoryDb()

const WW = 'geheim-wachtwoord-1'

function browser() {
  let cookie = ''
  return async (pad: string, body?: unknown, method?: string) => {
    const r = await app.request(pad, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'User-Agent': 'test', 'X-Forwarded-For': '10.0.0.9' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const zet = r.headers.get('set-cookie')
    const m = zet && /fonos_sessie=([^;]*)/.exec(zet)
    if (m) cookie = m[1] ? `fonos_sessie=${m[1]}` : ''
    return { status: r.status, data: await r.json().catch(() => ({})) as any }
  }
}

test('Instagram-adres: alleen een instagram.com-account, daarna in de kioskconfig', async () => {
  await zetInstelling('tweestaps', 'uit')
  await maakGebruiker({ email: 'beheer@beeldengeluid.nl', naam: 'Beheer', rollen: ['beheerder'], wachtwoord: WW })
  const b = browser()
  assert.equal((await b('/api/auth/login', { email: 'beheer@beeldengeluid.nl', wachtwoord: WW })).status, 200)

  for (const fout of ['https://example.com/fonos', 'http://instagram.com/fonos', 'https://www.instagram.com/fonos/p/abc', 'javascript:alert(1)']) {
    assert.equal((await b('/api/beheer/instellingen', { instagram_url: fout }, 'PUT')).status, 400, fout)
  }
  assert.equal((await b('/api/kiosk/config')).data.instellingen.instagram_url, '')

  assert.equal((await b('/api/beheer/instellingen', { instagram_url: 'https://www.instagram.com/fonos.nl' }, 'PUT')).status, 200)
  assert.equal((await b('/api/kiosk/config')).data.instellingen.instagram_url, 'https://www.instagram.com/fonos.nl')

  assert.equal((await b('/api/beheer/instellingen', { instagram_url: '' }, 'PUT')).status, 200)
  assert.equal((await b('/api/kiosk/config')).data.instellingen.instagram_url, '')
})
