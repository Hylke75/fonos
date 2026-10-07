// Demovulling, alleen voor test en demonstratie: npm run demo
// Demo-exemplaren (objectnummers 900000000+, vindcodes zoals A-12-03) voor de lp's en cd's uit de
// Muziekweb-import, plus drie demogebruikers (wachtwoord fonos-demo). Niet gebruiken in productie.
import { get } from '../server/db.ts'
import { laadDemo } from '../server/vulling.ts'
import { maakGebruiker } from '../server/auth.ts'

await laadDemo(Number(process.argv[2] ?? 60000))
for (const [email, naam, rollen] of [
  ['beheerder@fonos.demo', 'Eva Visser', ['beheerder', 'redacteur', 'medewerker']],
  ['redacteur@fonos.demo', 'Ruben de Wit', ['redacteur']],
  ['medewerker@fonos.demo', 'Jamie Dekker', ['medewerker']],
] as const) {
  if (!(await get('SELECT id FROM gebruikers WHERE lower(email) = lower(?)', email))) {
    await maakGebruiker({ email, naam, rollen: [...rollen], wachtwoord: 'fonos-demo' })
    console.log(`Gebruiker ${email} / wachtwoord: fonos-demo`)
  }
}
process.exit(0)
