// Browsertests als gekoppelde kiosktablet: het kioskcookie uit scripts/e2e-vul.ts.
import type { BrowserContext } from '@playwright/test'

export const alsKiosk = (ctx: BrowserContext, baseURL = 'http://localhost:3222') =>
  ctx.addCookies([{ name: 'fonos_kiosk', value: 'e2e-kiosk-token', url: baseURL }])
