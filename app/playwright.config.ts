// Browsertests (verbetering 19): de hele kioskstroom en het inloggen met tweestaps, plus een toegankelijkheidscontrole.
// Draaien: npm run test:e2e (bouwt de frontend, vult PGlite met testdata en start de server op poort 3222).
import { defineConfig } from '@playwright/test'

const PORT = 3222
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // één database, tests na elkaar
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-rapport' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // In de Claude-omgeving staat Chromium op een vaste plek; in de CI installeert Playwright hem zelf.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: `npx vite build && npx tsx scripts/e2e-vul.ts && NODE_ENV=production PORT=${PORT} npx tsx server/index.ts`,
    url: `http://localhost:${PORT}/api/gezond`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { FONOS_DATA_DIR: '.e2e-data', FONOS_HTTPS: '0', DATABASE_URL: '' },
  },
})
