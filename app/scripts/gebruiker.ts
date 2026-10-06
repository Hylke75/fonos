// Eerste beheerder aanmaken of een wachtwoord zetten vanaf de opdrachtregel:
//   npm run gebruiker -- <e-mail> "<naam>" <wachtwoord> [rollen, standaard beheerder,redacteur,medewerker]
import { get, run } from '../server/db.ts'
import { hashWachtwoord, maakGebruiker } from '../server/auth.ts'

const [email, naam, wachtwoord, rollen = 'beheerder,redacteur,medewerker'] = process.argv.slice(2)
if (!email || !naam || !wachtwoord) { console.error('Gebruik: npm run gebruiker -- <e-mail> "<naam>" <wachtwoord> [rollen]'); process.exit(1) }
if (wachtwoord.length < 10) { console.error('Kies een wachtwoord van minstens 10 tekens.'); process.exit(1) }
const r = rollen.split(',').map((x) => x.trim()).filter((x) => ['medewerker', 'redacteur', 'beheerder'].includes(x))
const g = get<{ id: number }>('SELECT id FROM gebruikers WHERE email = ?', email)
if (g) {
  run('UPDATE gebruikers SET naam = ?, wachtwoord = ?, rollen = ?, actief = 1 WHERE id = ?', naam, hashWachtwoord(wachtwoord), JSON.stringify(r), g.id)
  console.log(`Gebruiker ${email} bijgewerkt (${r.join(', ')}).`)
} else {
  maakGebruiker({ email, naam, rollen: r as any, wachtwoord })
  console.log(`Gebruiker ${email} aangemaakt (${r.join(', ')}).`)
}
