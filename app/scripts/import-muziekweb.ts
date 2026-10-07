// Muziekweb-import vanaf de opdrachtregel: npm run import:muziekweb -- <fonotheek.db.gz | exportmap | muziekweb.db | dump.jsonl>
import { resolve } from 'node:path'
import { statSync } from 'node:fs'
import { kiesLezer } from '../server/importers/muziekweb-lezers.ts'
import { verwerkMuziekwebImport } from '../server/importers/muziekweb-verwerk.ts'
import { laadExports, laadFonotheek } from '../server/vulling.ts'
import { SYSTEEM } from '../server/log.ts'

const pad = resolve(process.argv[2] ?? '../fonotheek.db.gz')
const t0 = Date.now()
if (/fonotheek[^/]*\.db(\.gz)?$/i.test(pad)) {
  // fonotheek.db: albums én gebruikscollectie, zoals bij de build.
  await laadFonotheek(pad)
} else if (statSync(pad).isDirectory()) {
  // Exportmap: alleen de delen die nog niet geladen zijn.
  const r = await laadExports(pad)
  if (r) console.log(JSON.stringify({ ...r, niet_in_dump_voorbeelden: r.niet_in_dump_voorbeelden.slice(0, 10) }, null, 2))
} else {
  const r = await verwerkMuziekwebImport(await kiesLezer(pad), { ...SYSTEEM, naam: 'Opdrachtregel' }, pad, (n) => console.log(`  ${n} records`))
  console.log(JSON.stringify(r, null, 2))
}
console.log(`Klaar in ${Math.round((Date.now() - t0) / 1000)} s`)
process.exit(0)
