// Browsertest: de kiosk en het inlogscherm op twee telefoons en een iPad (staand en liggend).
// Niets mag buiten beeld vallen: de pagina wordt niet breder dan het scherm en de knoppen in de kop staan in beeld.
import { devices, expect, test, type Page } from '@playwright/test'

const TOESTELLEN = {
  telefoon: devices['iPhone 13'],
  'kleine telefoon': devices['iPhone 13 Mini'],
  'iPad staand': devices['iPad (gen 7)'],
  'iPad liggend': devices['iPad (gen 7) landscape'],
}

async function pastInBeeld(page: Page, naam: string) {
  await page.waitForTimeout(300)
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    // Elementen die rechts of links buiten beeld vallen, behalve binnen een bewust scrollende rij (hoezen, tabs).
    const scrollt = (el: Element) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return true; return false }
    const uit = [...document.querySelectorAll('.kiosk-scherm *, .login *, .hero-inhoud *')]
      .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1) && !scrollt(el) && !el.closest('.vorm, .bol') })
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`)
    return { breed: document.documentElement.scrollWidth, vw, uit: [...new Set(uit)].slice(0, 5) }
  })
  expect(r.breed, `${naam}: pagina breder dan het scherm`).toBeLessThanOrEqual(r.vw)
  expect(r.uit, `${naam}: buiten beeld`).toEqual([])
}

for (const [toestel, { defaultBrowserType: _, ...instellingen }] of Object.entries(TOESTELLEN)) {
  test(`past op ${toestel}`, async ({ browser }) => {
    const ctx = await browser.newContext({ ...instellingen, baseURL: test.info().project.use.baseURL })
    const page = await ctx.newPage()
    await page.goto('/?tablet=E2E-mobiel')
    await pastInBeeld(page, 'rustscherm')
    await page.getByRole('button', { name: 'Begin met zoeken' }).click()
    await pastInBeeld(page, 'platenspeler kiezen')
    await page.locator('.speler:not([disabled])').first().click()
    await expect(page.getByRole('button', { name: /Platenspeler \d+ vrijgeven/ })).toBeVisible()
    await pastInBeeld(page, 'homepagina')
    // Logo en knoppen staan op één regel; de zoekbalk mag eronder.
    const midden = async (sel: string) => { const b = (await page.locator(sel).first().boundingBox())!; return b.y + b.height / 2 }
    expect(Math.abs((await midden('.kiosk-header .kop-logo')) - (await midden('.kiosk-header .rechts'))), 'logo en knoppen op één regel').toBeLessThan(12)
    await page.getByRole('searchbox').or(page.getByLabel('Zoeken').first()).fill('herman')
    await page.keyboard.press('Enter')
    await expect(page.getByText(/Resultaten voor/)).toBeVisible()
    await pastInBeeld(page, 'zoekresultaten')
    await page.locator('.raster .album-kaart').first().click()
    await expect(page.getByRole('button', { name: 'Voeg toe aan aanvraag' })).toBeVisible()
    await pastInBeeld(page, 'albumpagina')
    await page.getByRole('button', { name: 'Voeg toe aan aanvraag' }).click()
    await page.getByRole('link', { name: /Jouw aanvraag/ }).click()
    await expect(page.getByRole('button', { name: /Aanvraag versturen/ })).toBeVisible()
    await pastInBeeld(page, 'aanvraag')
    await page.getByRole('button', { name: 'Grotere tekst en meer contrast' }).click()
    await pastInBeeld(page, 'aanvraag met grotere tekst')
    // Speler weer vrijgeven voor de volgende test.
    await page.getByRole('button', { name: /Platenspeler \d+ vrijgeven/ }).click()
    await page.getByRole('button', { name: /vrijgeven/i }).last().click()
    await expect(page.getByRole('button', { name: 'Begin met zoeken' })).toBeVisible()
    await page.goto('/medewerker')
    await pastInBeeld(page, 'inloggen')
    await ctx.close()
  })
}
