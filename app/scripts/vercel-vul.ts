// Draait bij elke Vercel-build (na de frontend-build): schema, Muziekweb-exports, collectie, eerste beheerder.
// Idempotent: al geladen delen worden overgeslagen. Zonder DATABASE_URL gebeurt er niets.
import { db } from '../server/db.ts'
import { herstelJaren, laadCollectie, laadDemo, laadExports, zorgVoorBeheerder } from '../server/vulling.ts'

if (!process.env.DATABASE_URL) {
  console.log('[vulling] Geen DATABASE_URL: database wordt niet gevuld.')
  process.exit(0)
}
const t0 = Date.now()
await db()
await laadExports()
if (!(await laadCollectie())) await laadDemo()
await herstelJaren()
await zorgVoorBeheerder()
console.log(`[vulling] klaar in ${Math.round((Date.now() - t0) / 1000)} s`)
process.exit(0)
