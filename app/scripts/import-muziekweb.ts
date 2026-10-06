// Muziekweb-import vanaf de opdrachtregel: npm run import:muziekweb -- <exportmap | muziekweb.db | dump.jsonl>
import { resolve } from 'node:path'
import { statSync } from 'node:fs'
import { kiesLezer } from '../server/importers/muziekweb-lezers.ts'
import { verwerkMuziekwebImport } from '../server/importers/muziekweb-verwerk.ts'
import { laadExports } from '../server/vulling.ts'
import { SYSTEEM } from '../server/log.ts'

const pad = resolve(process.argv[2] ?? '../exports')
const t0 = Date.now()
if (statSync(pad).isDirectory()) {
  // Exportmap: alleen de delen die nog niet geladen zijn.
  const r = await laadExports(pad)
  if (r) console.log(JSON.stringify({ ...r, niet_in_dump_voorbeelden: r.niet_in_dump_voorbeelden.slice(0, 10) }, null, 2))
} else {
  const r = await verwerkMuziekwebImport(kiesLezer(pad), { ...SYSTEEM, naam: 'Opdrachtregel' }, pad, (n) => console.log(`  ${n} records`))
  console.log(JSON.stringify(r, null, 2))
}
console.log(`Klaar in ${Math.round((Date.now() - t0) / 1000)} s`)
process.exit(0)
