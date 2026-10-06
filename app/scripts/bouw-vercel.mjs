// Bouwt de Vercel Build Output (v3): statische frontend + één Node-functie voor /api.
// Zie https://vercel.com/docs/build-output-api/v3
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const uit = resolve(app, '..', '.vercel', 'output')
rmSync(uit, { recursive: true, force: true })
mkdirSync(join(uit, 'static'), { recursive: true })
cpSync(join(app, 'dist'), join(uit, 'static'), { recursive: true })

const func = join(uit, 'functions', 'api.func')
mkdirSync(func, { recursive: true })
await build({
  entryPoints: [join(app, 'server', 'vercel.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(func, 'index.mjs'),
  external: ['@electric-sql/pglite', '@electric-sql/pglite/*', 'node:sqlite'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
})
// Bestanden die de server bij het opstarten leest.
cpSync(join(app, 'server', 'schema.sql'), join(func, 'schema.sql'))
mkdirSync(join(func, 'shared'), { recursive: true })
cpSync(join(app, 'shared', 'genres-startvulling.json'), join(func, 'shared', 'genres-startvulling.json'))
writeFileSync(join(func, 'package.json'), JSON.stringify({ type: 'module' }))
writeFileSync(join(func, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false,
  supportsResponseStreaming: true, maxDuration: 300, regions: ['dub1'],
}, null, 2))

writeFileSync(join(uit, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/api(/.*)?$', dest: '/api' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
  crons: [{ path: '/api/cron', schedule: '0 2 * * *' }],
}, null, 2))
console.log(`Vercel-output klaar in ${uit}`)
