// Demovulling, alleen voor test en demonstratie: npm run demo
// Demo-exemplaren (objectnummers 900000000+, vindcodes zoals A-12-03) voor de lp's en cd's uit de
// Muziekweb-import, plus drie demogebruikers met een willekeurig wachtwoord (eenmalig getoond).
// Weigert in productie en op Vercel (securityreview R3).
import { randomBytes } from 'node:crypto'
import { get } from '../server/db.ts'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL || /supabase|pooler/.test(process.env.DATABASE_URL ?? '')) {
  console.error('De demovulling is alleen voor een lokale testdatabase, niet voor productie.')
  process.exit(1)
}
import { laadDemo } from '../server/vulling.ts'
import { maakGebruiker } from '../server/auth.ts'

await laadDemo(Number(process.argv[2] ?? 60000))
for (const [email, naam, rollen] of [
  ['beheerder@fonos.demo', 'Eva Visser', ['beheerder', 'redacteur', 'medewerker']],
  ['redacteur@fonos.demo', 'Ruben de Wit', ['redacteur']],
  ['medewerker@fonos.demo', 'Jamie Dekker', ['medewerker']],
] as const) {
  if (!(await get('SELECT id FROM gebruikers WHERE lower(email) = lower(?)', email))) {
    const wachtwoord = `Demo-${randomBytes(9).toString('base64url')}`
    await maakGebruiker({ email, naam, rollen: [...rollen], wachtwoord })
    console.log(`Gebruiker ${email} / wachtwoord: ${wachtwoord}`)
  }
}
process.exit(0)
