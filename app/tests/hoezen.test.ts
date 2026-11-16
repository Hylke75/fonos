// Muziekweb-hoezen via het eigen domein (/api/hoes): alleen media.cdr.nl, lang gecachet, en de client gebruikt het.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL

const { useMemoryDb } = await import('../server/db.ts')
const { app } = await import('../server/app.ts')
const { viaApp } = await import('../src/components/hoesUrl.ts')
await useMemoryDb()

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const echteFetch = globalThis.fetch
const opgehaald: string[] = []
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input)
  if (!url.startsWith('https://media.cdr.nl/')) return echteFetch(input, init)
  opgehaald.push(url)
  if (url.includes('/ONTBREEKT')) return new Response('<html>niet gevonden</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
  return new Response(JPEG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
}) as typeof fetch

const hoes = (u: string) => app.request(`/api/hoes?u=${encodeURIComponent(u)}`)

test('hoes van media.cdr.nl komt via het eigen domein, lang gecachet', async () => {
  const r = await hoes('https://media.cdr.nl/COVER/SMALL/FRONT/AA00449/Symphony-n%C2%B0-7.jpg')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/jpeg')
  assert.match(r.headers.get('cache-control') ?? '', /s-maxage=2592000/)
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), JPEG)
})

test('http-adressen worden via https opgehaald', async () => {
  const r = await hoes('http://media.cdr.nl/COVER/PICO/FRONT/AA00449.jpg')
  assert.equal(r.status, 200)
  assert.equal(opgehaald.at(-1), 'https://media.cdr.nl/COVER/PICO/FRONT/AA00449.jpg')
})

test('geen open proxy: andere hosts en paden worden geweigerd', async () => {
  for (const u of ['https://example.com/COVER/x.jpg', 'https://media.cdr.nl.example.com/COVER/x.jpg', 'https://media.cdr.nl/AUDIO/x.mp3', 'file:///etc/passwd', 'geen-url']) {
    const r = await hoes(u)
    assert.equal(r.status, 400, u)
  }
})

test('geen afbeelding terug = 404 (de kiosk toont dan de placeholder)', async () => {
  const r = await hoes('https://media.cdr.nl/COVER/MEDIUM/FRONT/ONTBREEKT.jpg')
  assert.equal(r.status, 404)
})

test('viaApp: alleen Muziekweb-hoezen gaan via /api/hoes', () => {
  assert.equal(viaApp('https://media.cdr.nl/COVER/SMALL/FRONT/A/b.jpg'), '/api/hoes?u=https%3A%2F%2Fmedia.cdr.nl%2FCOVER%2FSMALL%2FFRONT%2FA%2Fb.jpg')
  assert.equal(viaApp('http://media.cdr.nl/COVER/PICO/FRONT/A.jpg'), '/api/hoes?u=https%3A%2F%2Fmedia.cdr.nl%2FCOVER%2FPICO%2FFRONT%2FA.jpg')
  assert.equal(viaApp('/api/bestand/hoezen/x.jpg'), '/api/bestand/hoezen/x.jpg')
  assert.equal(viaApp('https://i.scdn.co/image/abc'), 'https://i.scdn.co/image/abc')
  assert.equal(viaApp(null), null)
})
