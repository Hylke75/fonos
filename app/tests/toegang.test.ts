// Securityreview (november 2026): de toegangsmodule en de andere structurele maatregelen.
// Deze tests lopen over ALLE routes: een nieuwe route zonder regel in server/toegang.ts, of een route die zonder
// inloggen of koppeling iets toelaat wat niet openbaar is, laat de CI falen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL
delete process.env.CRON_SECRET

const { useMemoryDb, get, zetInstelling } = await import('../server/db.ts')
const { maakGebruiker, maakResetToken, wachtwoordFout, zetWachtwoord, resetWachtwoord } = await import('../server/auth.ts')
const { app } = await import('../server/app.ts')
const { eisVoor, REGELS, maakKoppelcode } = await import('../server/toegang.ts')
const { magNaar, magPush, haal } = await import('../server/naarbuiten.ts')
const { versleutel, ontsleutel, hashToken } = await import('../server/geheimen.ts')
const { afbeeldingType } = await import('../server/routes/beheer.ts')
await useMemoryDb()
await zetInstelling('tweestaps', 'uit')

const WW = 'Lang-genoeg-wachtwoord-9'
await maakGebruiker({ email: 'beheer@beeldengeluid.nl', naam: 'Bea Heer', rollen: ['beheerder'], wachtwoord: WW })
await maakGebruiker({ email: 'redactie@beeldengeluid.nl', naam: 'Ruud Actie', rollen: ['redacteur'], wachtwoord: WW })
await maakGebruiker({ email: 'balie@beeldengeluid.nl', naam: 'Mo Werker', rollen: ['medewerker'], wachtwoord: WW })

type Antwoord = { status: number; data: any; headers: Headers }
async function vraag(pad: string, o: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Promise<Antwoord> {
  const r = await app.request(pad, {
    method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(o.cookie ? { Cookie: o.cookie } : {}), ...o.headers },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  })
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }
}
async function inloggen(email: string) {
  const r = await vraag('/api/auth/login', { body: { email, wachtwoord: WW } })
  assert.equal(r.status, 200, `inloggen ${email}`)
  return /fonos_sessie=[^;]+/.exec(r.headers.get('set-cookie') ?? '')![0]
}
const voorbeeld = (pad: string) => pad.replace(/:[A-Za-z_]+/g, '1').replace(/\*$/, 'x')
const routes = () => app.routes.filter((r) => r.method !== 'ALL' && (r.path.startsWith('/api/') || r.path.startsWith('/uploads/')))
  .map((r) => ({ method: r.method, pad: voorbeeld(r.path), patroon: r.path }))

test('elke route heeft een toegangsregel (een nieuwe route zonder regel is dicht en laat deze test falen)', () => {
  const zonder = routes().filter((r) => !eisVoor(r.method, r.pad)).map((r) => `${r.method} ${r.patroon}`)
  assert.deepEqual(zonder, [], 'Voeg deze routes toe aan REGELS in server/toegang.ts')
  assert.ok(routes().length > 80, 'alle routes gevonden')
  assert.equal(eisVoor('GET', '/api/bestaat-niet'), null)
  assert.ok(REGELS.every(([, p]) => p.startsWith('/api/') || p.startsWith('/uploads/')))
})

test('zonder inloggen of koppeling: elke niet-openbare route weigert', async () => {
  const lek: string[] = []
  for (const r of routes()) {
    const eis = eisVoor(r.method, r.pad)
    if (eis === 'openbaar') continue
    const a = await vraag(r.pad, { method: r.method, body: r.method === 'GET' ? undefined : {} })
    if (![401, 403].includes(a.status)) lek.push(`${r.method} ${r.patroon} (${eis}) gaf ${a.status}`)
  }
  assert.deepEqual(lek, [])
})

test('rollen: medewerker niet in beheer, redacteur niet bij beheerderszaken', async () => {
  const mw = await inloggen('balie@beeldengeluid.nl')
  const red = await inloggen('redactie@beeldengeluid.nl')
  const fout: string[] = []
  for (const r of routes()) {
    const eis = eisVoor(r.method, r.pad)
    const als = eis === 'redacteur' || eis === 'beheerder' ? mw : eis === 'medewerker' ? red : null
    if (als) {
      const a = await vraag(r.pad, { method: r.method, body: r.method === 'GET' ? undefined : {}, cookie: als })
      if (a.status !== 403) fout.push(`${r.method} ${r.patroon} (${eis}) gaf ${a.status}`)
    }
    if (eis === 'beheerder') {
      const a = await vraag(r.pad, { method: r.method, body: r.method === 'GET' ? undefined : {}, cookie: red })
      if (a.status !== 403) fout.push(`${r.method} ${r.patroon} (beheerder, als redacteur) gaf ${a.status}`)
    }
  }
  assert.deepEqual(fout, [])
  // Het wijzigingslog: een redacteur ziet geen gebruikers, instellingen of storingsmeldingen (R13).
  const { log, SYSTEEM } = await import('../server/log.ts')
  await log(SYSTEEM, 'storingsmelding', { type: 'melding', id: 'x', label: 'geheim' })
  const regels = (await vraag('/api/beheer/log', { cookie: red })).data.regels as any[]
  assert.ok(!regels.some((l) => ['melding', 'gebruiker', 'instelling'].includes(l.record_type)))
  const beh = await inloggen('beheer@beeldengeluid.nl')
  assert.ok(((await vraag('/api/beheer/log', { cookie: beh })).data.regels as any[]).some((l) => l.record_type === 'melding'))
})

test('kiosk koppelen: alleen met een geldige, eenmalige code; daarna mag de tablet een speler kiezen', async () => {
  // Niet gekoppeld: lezen mag, een speler kiezen niet (R1).
  assert.equal((await vraag('/api/kiosk/config')).data.gekoppeld, false)
  assert.equal((await vraag('/api/kiosk/speler', { body: { platenspeler: 1 } })).status, 401)
  assert.equal((await vraag('/api/kiosk/aanvraag', { body: { platenspeler: 1, titels: [] } })).status, 401)
  assert.equal((await vraag('/api/kiosk/koppelen', { body: { code: 'AAAAAAAA' } })).status, 400)
  // Een beheerder maakt een code; die staat alleen als hash in de database.
  const beh = await inloggen('beheer@beeldengeluid.nl')
  const k = await vraag('/api/beheer/kiosks/koppelcode', { body: { naam: 'Bar rechts' }, cookie: beh })
  assert.equal(k.status, 200)
  assert.match(k.data.code, /^[A-Z2-9]{8}$/)
  assert.ok(!(await get('SELECT 1 FROM kiosks WHERE code_hash = ?', k.data.code)))
  const r = await vraag('/api/kiosk/koppelen', { body: { code: k.data.code.toLowerCase() } })
  assert.equal(r.status, 200)
  assert.equal(r.data.naam, 'Bar rechts')
  const zet = r.headers.get('set-cookie') ?? ''
  assert.match(zet, /HttpOnly/i)
  assert.match(zet, /SameSite=Strict/i)
  const kiosk = /fonos_kiosk=[^;]+/.exec(zet)![0]
  // Eenmalig: dezelfde code werkt niet nog eens.
  assert.equal((await vraag('/api/kiosk/koppelen', { body: { code: k.data.code } })).status, 400)
  assert.equal((await vraag('/api/kiosk/config', { cookie: kiosk })).data.gekoppeld, true)
  const s = await vraag('/api/kiosk/speler', { body: { platenspeler: 1 }, cookie: kiosk })
  assert.equal(s.status, 200)
  await vraag('/api/kiosk/speler/vrijgeven', { body: { platenspeler: 1, sessie: s.data.sessie }, cookie: kiosk })
  // Een medewerker kan ook zonder koppeling (bv. om te testen).
  assert.equal((await vraag('/api/kiosk/wachtlijst', { body: {}, cookie: await inloggen('balie@beeldengeluid.nl') })).status, 200)
  // Ontkoppelen: het cookie werkt niet meer.
  assert.equal((await vraag('/api/beheer/kiosk/Bar%20rechts', { method: 'DELETE', cookie: beh })).status, 200)
  assert.equal((await vraag('/api/kiosk/speler', { body: { platenspeler: 1 }, cookie: kiosk })).status, 401)
  // Raden wordt afgeremd.
  for (let i = 0; i < 12; i++) await vraag('/api/kiosk/koppelen', { body: { code: 'BBBBBBBB' }, headers: { 'X-Forwarded-For': '9.9.9.9' } })
  assert.ok([400, 429].includes((await vraag('/api/kiosk/koppelen', { body: { code: 'BBBBBBBB' } })).status))
})

test('cron: zonder CRON_SECRET niemand, met het geheim wel (R7)', async () => {
  assert.equal((await vraag('/api/cron')).status, 401)
  process.env.CRON_SECRET = 'cron-geheim-voor-de-test'
  try {
    assert.equal((await vraag('/api/cron', { headers: { Authorization: 'Bearer fout' } })).status, 401)
    assert.equal((await vraag('/api/cron', { headers: { Authorization: 'Bearer cron-geheim-voor-de-test' } })).status, 200)
  } finally { delete process.env.CRON_SECRET }
})

test('CSRF: een formulier of tekstverzoek van een andere site wordt geweigerd (R10)', async () => {
  const beh = await inloggen('beheer@beeldengeluid.nl')
  const r = await app.request('/api/beheer/kiosks/koppelcode', { method: 'POST', body: '{"naam":"x"}',
    headers: { 'Content-Type': 'text/plain', Origin: 'https://kwaadaardig.example', Cookie: beh } })
  assert.equal(r.status, 403)
  const ok = await app.request('/api/beheer/kiosks/koppelcode', { method: 'POST', body: '{"naam":"x"}',
    headers: { 'Content-Type': 'text/plain', Origin: 'http://localhost', Cookie: beh } })
  assert.equal(ok.status, 200)
})

test('fouten: geen interne tekst naar buiten, kapotte JSON is 400 zonder storingsmelding (R8, R16)', async () => {
  const kapot = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{kapot' })
  assert.equal(kapot.status, 400)
  // Een interne fout (hier een TypeError) geeft een algemene tekst met referentie, niet de fouttekst zelf.
  const intern = await vraag('/api/kiosk/beschikbaarheid', { body: { ids: 5 } })
  assert.equal(intern.status, 500)
  assert.match(intern.data.fout, /^Er ging iets mis \(referentie [0-9a-f]{8}\)\.$/)
  const { foutTekst } = await import('../server/fouten.ts')
  assert.equal(foutTekst(new Error('Alleen jpg, png of webp')), 'Alleen jpg, png of webp')
  assert.match(foutTekst(Object.assign(new Error('relation "x" does not exist'), { code: '42P01' })), /referentie/)
})

test('uploads: het type komt uit de inhoud, niet uit de naam of de browser (R2)', () => {
  assert.equal(afbeeldingType(Buffer.from('<html><script>alert(1)</script></html>')), null)
  assert.equal(afbeeldingType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.type, 'image/jpeg')
  assert.equal(afbeeldingType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.type, 'image/png')
})

test('uitgaande verbindingen: alleen toegestane hosts, alleen https (R9, R14)', async () => {
  assert.ok(magNaar('hoezen', 'https://media.cdr.nl/COVER/x.jpg'))
  assert.ok(!magNaar('hoezen', 'http://media.cdr.nl/COVER/x.jpg'))
  assert.ok(!magNaar('hoezen', 'https://169.254.169.254/latest/meta-data'))
  assert.ok(!magNaar('opslag', 'https://intern.beeldengeluid.nl/backup.zip'))
  assert.ok(magNaar('opslag', 'https://abc.private.blob.vercel-storage.com/backups/x.zip'))
  assert.ok(!magNaar('nieuwsbrief', 'https://10.0.0.5/hook'))
  assert.ok(!magNaar('nieuwsbrief', 'https://localhost/hook'))
  assert.ok(!magNaar('mail', 'https://user:pw@api.resend.com/emails'))
  await assert.rejects(haal('opslag', 'https://intern.example/x'))
  assert.ok(magPush('https://fcm.googleapis.com/fcm/send/abc'))
  assert.ok(!magPush('https://intern.example/push'))
})

test('geheimen: tokens als hash, TOTP versleuteld als er een sleutel is (R3)', async () => {
  const beh = await inloggen('beheer@beeldengeluid.nl')
  const token = beh.split('=')[1]
  assert.ok(!(await get('SELECT 1 FROM sessies WHERE token = ?', token)), 'sessietoken staat niet leesbaar in de database')
  assert.ok(await get('SELECT 1 FROM sessies WHERE token = ?', hashToken(token)))
  const g = (await get<any>("SELECT id FROM gebruikers WHERE email = 'balie@beeldengeluid.nl'"))!
  const reset = await maakResetToken(g.id)
  assert.ok(!(await get('SELECT 1 FROM gebruikers WHERE reset_token = ?', reset)))
  process.env.FONOS_GEHEIM_SLEUTEL = 'sleutel-voor-de-test'
  try {
    const v = versleutel('JBSWY3DPEHPK3PXP')
    assert.ok(v.startsWith('v1:') && !v.includes('JBSWY3DPEHPK3PXP'))
    assert.equal(ontsleutel(v), 'JBSWY3DPEHPK3PXP')
    assert.equal(ontsleutel('JBSWY3DPEHPK3PXP'), 'JBSWY3DPEHPK3PXP') // oude waarde blijft leesbaar
  } finally { delete process.env.FONOS_GEHEIM_SLEUTEL }
})

test('wachtwoordbeleid: 12 tekens, 3 soorten, geen naam, geen hergebruik (Securitybeleid 2.1.1)', async () => {
  const g = { email: 'mo.werker@beeldengeluid.nl', naam: 'Mo Werker' }
  assert.ok(wachtwoordFout('kort-1A', g))
  assert.ok(wachtwoordFout('alleenkleineletters', g))
  assert.ok(wachtwoordFout('Werker-is-de-baas-1', g))
  assert.equal(wachtwoordFout('Platenspeler-2026!', g), null)
  const id = (await get<any>("SELECT id FROM gebruikers WHERE email = 'balie@beeldengeluid.nl'"))!.id
  assert.equal(await zetWachtwoord(id, 'Platenspeler-2026!'), null)
  assert.equal(await zetWachtwoord(id, 'Draaitafel-Twee-2026'), null)
  assert.match(String(await zetWachtwoord(id, 'Platenspeler-2026!')), /eerder gebruikt/)
  const token = await maakResetToken(id)
  assert.deepEqual(await resetWachtwoord(token, 'kort'), { fout: 'Kies een wachtwoord van minstens 12 tekens.' })
  assert.deepEqual(await resetWachtwoord(token, 'Nog-een-goed-wachtwoord-7'), { ok: true })
  assert.ok('fout' in (await resetWachtwoord(token, 'Nog-een-goed-wachtwoord-8')), 'reset-link is eenmalig')
})

test('resetlinks: nooit naar het adres uit de Host-header, en een rem per adres (R12, R15)', async () => {
  const { basisUrl } = await import('../server/verzoek.ts')
  const nep = { req: { url: 'https://kwaadaardig.example/api/auth/reset-aanvraag' } } as any
  assert.throws(() => basisUrl(nep), /FONOS_BASIS_URL/)
  process.env.FONOS_BASIS_URL = 'https://luisterbar.example'
  try { assert.equal(basisUrl(nep), 'https://luisterbar.example') } finally { delete process.env.FONOS_BASIS_URL }
  for (let i = 0; i < 3; i++) await vraag('/api/auth/reset-aanvraag', { body: { email: 'redactie@beeldengeluid.nl' } })
  const voor = (await get<any>("SELECT reset_token FROM gebruikers WHERE email = 'redactie@beeldengeluid.nl'"))!.reset_token
  await vraag('/api/auth/reset-aanvraag', { body: { email: 'redactie@beeldengeluid.nl' } })
  const na = (await get<any>("SELECT reset_token FROM gebruikers WHERE email = 'redactie@beeldengeluid.nl'"))!.reset_token
  assert.equal(na, voor, 'de vierde aanvraag binnen een uur stuurt geen nieuwe mail')
})
