// Muziekweb-import vanaf de opdrachtregel: npm run import:muziekweb -- <exportmap | muziekweb.db | dump.jsonl>
import { kiesLezer } from '../server/importers/muziekweb-lezers.ts'
import { verwerkMuziekwebImport } from '../server/importers/muziekweb-verwerk.ts'
import { SYSTEEM } from '../server/log.ts'
import { resolve } from 'node:path'

const pad = resolve(process.argv[2] ?? '../exports')
console.log(`Muziekweb-import uit ${pad} …`)
const t0 = Date.now()
const rapport = await verwerkMuziekwebImport(kiesLezer(pad), { ...SYSTEEM, naam: 'Opdrachtregel' }, pad, (n) => {
  if (n % 10000 === 0) console.log(`  ${n} records`)
})
console.log(JSON.stringify({ ...rapport, niet_in_dump_voorbeelden: rapport.niet_in_dump_voorbeelden.slice(0, 10) }, null, 2))
console.log(`Klaar in ${Math.round((Date.now() - t0) / 1000)} s`)
