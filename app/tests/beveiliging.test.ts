// IT-beleid B&G: tweestapsverificatie, log van aanmeldingen, verlopen accounts, Google-claims, headers en monitoring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL

const { useMemoryDb, get, all, run, zetInstelling } = await import('../server/db.ts')
const { maakGebruiker } = await import('../server/auth.ts')
const { code, controleer, uitBase32, base32, huidigeStap } = await import('../server/totp.ts')
const { controleerClaims } = await import('../server/google.ts')
const { accountGeldigheid } = await import('../server/routes/beheer.ts')
const { dagelijkseControles } = await import('../server/planner.ts')
const { app } = await import('../server/app.ts')
await useMemoryDb()

const WW = 'geheim-wachtwoord-1'

/** Verzoek met cookies die tussen aanroepen bewaard blijven. */
function browser() {
  let cookie = ''
  return async (pad: string, body?: unknown, method?: string) => {
    const r = await app.request(pad, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'User-Agent': 'test', 'X-Forwarded-For': '10.0.0.1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const zet = r.headers.get('set-cookie')
    if (zet) {
      const m = /fonos_sessie=([^;]*)/.exec(zet)
      if (m) cookie = m[1] ? `fonos_sessie=${m[1]}` : ''
    }
    return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }
  }
}

test('TOTP: testvectoren uit RFC 6238 (SHA-1) en base32', () => {
  const geheim = base32(Buffer.from('12345678901234567890'))
  assert.equal(geheim, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.equal(uitBase32(geheim).toString(), '12345678901234567890')
  // RFC 6238 geeft 8 cijfers; de laatste 6 zijn de 6-cijferige code.
  assert.equal(code(geheim, Math.floor(59 / 30)), '287082')
  assert.equal(code(geheim, Math.floor(1111111109 / 30)), '081804')
  assert.equal(code(geheim, Math.floor(1234567890 / 30)), '005924')
  const nu = 1234567890 * 1000
  assert.equal(controleer(geheim, '005924', nu), Math.floor(1234567890 / 30))
  assert.equal(controleer(geheim, '005924', nu, Math.floor(1234567890 / 30)), null) // geen hergebruik
  assert.equal(controleer(geheim, '000000', nu), null)
  assert.equal(controleer(geheim, 'abc', nu), null)
})

test('inloggen met tweede stap: koppelen, code, sessie; alles in het log', async () => {
  await zetInstelling('tweestaps', 'iedereen')
  const id = await maakGebruiker({ email: 'twee@beeldengeluid.nl', naam: 'Twee Stap', rollen: ['medewerker'], wachtwoord: WW })
  const b = browser()
  const r1 = await b('/api/auth/login', { email: 'twee@beeldengeluid.nl', wachtwoord: WW })
  assert.equal(r1.status, 200)
  assert.equal(r1.data.stap, 'koppelen')
  assert.match(r1.data.otpauth, /^otpauth:\/\/totp\//)
  // Nog niet ingelogd zolang de code ontbreekt.
  assert.equal((await b('/api/auth/ik')).status, 401)
  assert.equal((await b('/api/auth/code', { code: '000000' })).status, 400)
  const r2 = await b('/api/auth/code', { code: code(r1.data.geheim, huidigeStap()) })
  assert.equal(r2.status, 200)
  assert.equal(r2.data.email, 'twee@beeldengeluid.nl')
  assert.equal((await b('/api/auth/ik')).status, 200)
  assert.equal((await get<any>('SELECT totp_aan FROM gebruikers WHERE id = ?', id)).totp_aan, 1)
  // Volgende keer: direct om de code vragen.
  const b2 = browser()
  assert.equal((await b2('/api/auth/login', { email: 'twee@beeldengeluid.nl', wachtwoord: WW })).data.stap, 'code')
  await b('/api/auth/logout', {})
  const log = await all<any>('SELECT methode, gelukt, reden, ip, apparaat FROM aanmeldingen WHERE gebruiker_id = ? ORDER BY id', id)
  assert.deepEqual(log.map((l) => `${l.methode}:${l.gelukt}:${l.reden ?? ''}`), ['tweede_stap:0:code', 'tweede_stap:1:gekoppeld', 'uitloggen:1:'])
  assert.equal(log[0].ip, '10.0.0.1')
  assert.equal(log[0].apparaat, 'test')
})

test('mislukte aanmeldingen: gelogd, na 10 een kwartier geblokkeerd', async () => {
  await zetInstelling('tweestaps', 'uit')
  await maakGebruiker({ email: 'raad@beeldengeluid.nl', naam: 'Raad', rollen: ['medewerker'], wachtwoord: WW })
  const b = browser()
  for (let i = 0; i < 10; i++) assert.equal((await b('/api/auth/login', { email: 'raad@beeldengeluid.nl', wachtwoord: 'fout' })).status, 401)
  const r = await b('/api/auth/login', { email: 'raad@beeldengeluid.nl', wachtwoord: WW })
  assert.equal(r.status, 429)
  const n = (await get<any>("SELECT COUNT(*)::int AS n FROM aanmeldingen WHERE email = 'raad@beeldengeluid.nl' AND gelukt = 0")).n
  assert.equal(n, 11)
  // Er is een storingsmelding vastgelegd (eens per dag per account).
  assert.ok(await get("SELECT 1 FROM wijzigingslog WHERE actie = 'storingsmelding' AND record_id = 'inlogpogingen:raad@beeldengeluid.nl'"))
  // Onbekend adres: zelfde antwoord, wel gelogd.
  const o = await b('/api/auth/login', { email: 'niemand@beeldengeluid.nl', wachtwoord: 'x' })
  assert.equal(o.data.fout, 'E-mailadres of wachtwoord klopt niet.')
  assert.ok(await get("SELECT 1 FROM aanmeldingen WHERE email = 'niemand@beeldengeluid.nl' AND reden = 'onbekend'"))
})

test('accounts met einddatum: verlopen kan niet inloggen, sessies vervallen, herinnering vooraf', async () => {
  await zetInstelling('tweestaps', 'uit')
  const id = await maakGebruiker({ email: 'extern@beeldengeluid.nl', naam: 'Extern', rollen: ['medewerker'], wachtwoord: WW })
  await run("UPDATE gebruikers SET soort_account = 'extern', geldig_tot = to_char(now() + interval '3 days', 'YYYY-MM-DD') WHERE id = ?", id)
  const b = browser()
  assert.equal((await b('/api/auth/login', { email: 'extern@beeldengeluid.nl', wachtwoord: WW })).status, 200)
  assert.equal((await b('/api/auth/ik')).status, 200)
  await dagelijkseControles({ aanmeldingen_bewaar_dagen: 365, account_herinnering_dagen: 14 })
  assert.ok(await get('SELECT 1 FROM planner WHERE taak LIKE ?', `account-herinnering:${id}:%`))
  await run("UPDATE gebruikers SET geldig_tot = '2020-01-01' WHERE id = ?", id)
  assert.equal((await b('/api/auth/ik')).status, 401)
  const r = await browser()('/api/auth/login', { email: 'extern@beeldengeluid.nl', wachtwoord: WW })
  assert.equal(r.status, 401)
  assert.match(r.data.fout, /verlopen/)
  await dagelijkseControles({ aanmeldingen_bewaar_dagen: 365, account_herinnering_dagen: 14 })
  assert.ok(await get("SELECT 1 FROM wijzigingslog WHERE actie = 'account verlopen' AND record_id = ?", String(id)))
})

test('soort account: regels voor vast, tijdelijk en extern', () => {
  const jaar = new Date().getFullYear()
  assert.deepEqual(accountGeldigheid('vast', '2030-01-01'), { soort: 'vast', geldig_tot: null })
  assert.ok('fout' in accountGeldigheid('tijdelijk', null))
  assert.deepEqual(accountGeldigheid('tijdelijk', '2031-05-01'), { soort: 'tijdelijk', geldig_tot: '2031-05-01' })
  assert.deepEqual(accountGeldigheid('extern', null), { soort: 'extern', geldig_tot: `${jaar}-12-31` })
  assert.ok('fout' in accountGeldigheid('extern', `${jaar + 1}-03-01`))
  assert.ok('fout' in accountGeldigheid('onzin', null))
})

test('Google: alleen bevestigde adressen van het eigen domein', () => {
  process.env.GOOGLE_CLIENT_ID = 'klant-1'
  const nu = Date.now()
  const goed = { iss: 'https://accounts.google.com', aud: 'klant-1', exp: nu / 1000 + 60, nonce: 'n', email: 'Iemand@beeldengeluid.nl', email_verified: true, hd: 'beeldengeluid.nl' }
  assert.deepEqual(controleerClaims(goed, 'n', nu), { email: 'iemand@beeldengeluid.nl' })
  assert.ok('fout' in controleerClaims({ ...goed, hd: 'gmail.com', email: 'x@gmail.com' }, 'n', nu))
  assert.ok('fout' in controleerClaims({ ...goed, aud: 'ander' }, 'n', nu))
  assert.ok('fout' in controleerClaims({ ...goed, nonce: 'm' }, 'n', nu))
  assert.ok('fout' in controleerClaims({ ...goed, exp: nu / 1000 - 1 }, 'n', nu))
  assert.ok('fout' in controleerClaims({ ...goed, email_verified: false }, 'n', nu))
  delete process.env.GOOGLE_CLIENT_ID
})

test('beveiligingsheaders en gezondheidscheck', async () => {
  const r = await app.request('/api/gezond')
  assert.equal(r.status, 200)
  assert.equal((await r.json()).controles.database, true)
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  // Draait de nachtelijke taak wel, maar is er geen recente back-up: 503 voor de monitoring.
  await run("INSERT INTO planner (taak, datum) VALUES ('cron:laatst', nu()) ON CONFLICT (taak) DO UPDATE SET datum = excluded.datum")
  const r2 = await app.request('/api/gezond')
  assert.equal(r2.status, 503)
  assert.equal((await r2.json()).controles.backup, false)
})
