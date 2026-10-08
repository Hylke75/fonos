// Browsertests: kioskstroom (speler kiezen, zoeken, aanvragen, vrijgeven), Engels, inloggen met tweestaps,
// het medewerkersscherm en een toegankelijkheidscontrole (WCAG 2.1 AA, ernstige en kritieke bevindingen).
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createHmac } from 'node:crypto'

const ALFABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function totp(geheim: string) {
  let bits = 0, v = 0
  const b: number[] = []
  for (const c of geheim.replace(/\s/g, '')) { v = (v << 5) | ALFABET.indexOf(c); bits += 5; if (bits >= 8) { b.push((v >>> (bits - 8)) & 255); bits -= 8 } }
  const t = Buffer.alloc(8)
  t.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', Buffer.from(b)).update(t).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

async function toegankelijk(page: Page, naam: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const ernstig = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(ernstig.map((v) => `${naam}: ${v.id} (${v.nodes.length}×) ${v.help} – ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')}: ${(n.failureSummary ?? '').split('\n').slice(1, 2).join('')}`).join(' | ')}`)).toEqual([])
}

test.describe.serial('Fonotheek', () => {
  test('kiosk: speler kiezen, zoeken met reden, aanvragen en vrijgeven', async ({ page }) => {
    const fouten: string[] = []
    page.on('pageerror', (e) => fouten.push(e.message))
    await page.goto('/?tablet=E2E')
    await page.getByRole('button', { name: 'Begin met zoeken' }).click()
    await expect(page.getByRole('heading', { name: 'Kies je platenspeler' })).toBeVisible()
    await toegankelijk(page, 'speler kiezen')
    await page.getByRole('radio', { name: 'Platenspeler 1' }).click()
    await expect(page.locator('.speler-knop')).toContainText('1')

    await page.getByRole('search').getByRole('textbox').fill('suzanne')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Nummer: Suzanne')).toBeVisible()
    await toegankelijk(page, 'zoekresultaten')

    // Album zonder tracklist en "Meer van deze artiest"
    await page.goto('/album/' + (await page.request.get('/api/kiosk/zoek?q=solitude').then((r) => r.json())).titels[0].id)
    await expect(page.getByText('Van deze plaat is geen lijst met nummers bekend.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Meer van deze artiest' })).toBeVisible()
    await toegankelijk(page, 'albumpagina')
    await page.getByRole('button', { name: 'Voeg toe aan aanvraag' }).click()
    await expect(page.locator('.mand-knop .teller')).toHaveText('1')

    await page.locator('.mand-knop').click()
    await expect(page.getByRole('heading', { name: 'Jouw aanvraag' })).toBeVisible()
    await toegankelijk(page, 'aanvraag')
    await page.getByRole('button', { name: /Aanvraag versturen/ }).click()
    await expect(page.getByRole('heading', { name: 'Aanvraag verstuurd!' })).toBeVisible()
    await page.getByRole('button', { name: 'Platenspeler vrijgeven' }).click()
    await page.getByRole('button', { name: 'Ja, vrijgeven' }).click()
    await expect(page.getByRole('button', { name: 'Begin met zoeken' })).toBeVisible()
    expect(fouten).toEqual([])
  })

  test('kiosk in het Engels', async ({ page }) => {
    await page.goto('/')
    await page.locator('.taal-knop').click()
    await page.getByRole('button', { name: 'Start exploring' }).click()
    await expect(page.getByRole('heading', { name: 'Choose your record player' })).toBeVisible()
  })

  test('inloggen met tweestaps en het medewerkersscherm', async ({ page }) => {
    await page.goto('/medewerker')
    await page.getByLabel('E-mailadres').fill('e2e@fonotheek.test')
    await page.getByLabel('Wachtwoord').fill('e2e-wachtwoord-1')
    await page.getByRole('button', { name: 'Inloggen' }).click()
    const sleutel = (await page.locator('.totp-sleutel').innerText()).replace(/\s/g, '')
    await page.getByLabel('Code').fill('000000')
    await page.getByRole('button', { name: 'Bevestigen' }).click()
    await expect(page.locator('.melding-blok.fout')).toBeVisible()
    await page.getByLabel('Code').fill(totp(sleutel))
    await page.getByRole('button', { name: 'Bevestigen' }).click()
    await expect(page.getByRole('tab', { name: /Platenspelers/ })).toBeVisible()
    // De aanvraag uit de eerste test is afgesloten bij het vrijgeven: die staat bij Afgerond.
    await page.getByRole('tab', { name: 'Afgerond' }).click()
    await expect(page.getByText('#001').first()).toBeVisible()
    await page.getByRole('tab', { name: 'Looplijst' }).click()
    await toegankelijk(page, 'medewerkersscherm')
  })
})
