// Demovulling, alleen voor test en demonstratie: npm run demo
// Maakt demo-exemplaren (objectnummers 900000000+, vindcodes in de vorm A-12-03) voor de lp's en cd's
// uit de laatste Muziekweb-import, plus drie demogebruikers. Niet gebruiken in productie:
// de echte vulling komt uit de spreadsheets via npm run import:collectie.
import { all, db, get, run } from '../server/db.ts'
import { koppelLosseExemplaren } from '../server/importers/muziekweb-verwerk.ts'
import { maakGebruiker } from '../server/auth.ts'

const max = Number(process.argv[2] ?? 60000)
if (get<{ n: number }>('SELECT COUNT(*) n FROM exemplaren')!.n > 0) {
  console.log('Er zijn al exemplaren; demovulling overgeslagen.')
} else {
  const rijen = all<{ titelnummer: string; data: string }>('SELECT titelnummer, data FROM mw_dump ORDER BY titelnummer')
  const d = db()
  const ins = d.prepare("INSERT INTO exemplaren (objectnummer, titelnummer, vindcode, bron) VALUES (?, ?, ?, 'demo')")
  let n = 0
  d.exec('BEGIN')
  for (const r of rijen) {
    const v = JSON.parse(r.data).velden
    if (!['LP', 'CD'].includes(v.drager) || !v.titel) continue
    const kast = 'ABCDEFGH'[n % 8]
    ins.run(String(900000000 + n), r.titelnummer, `${kast}-${String((n >> 3) % 40 + 1).padStart(2, '0')}-${String((n >> 6) % 30 + 1).padStart(2, '0')}`)
    // Een paar titels krijgen een tweede exemplaar, zoals in de echte collectie (ca. 140 titels).
    if (n % 400 === 7) ins.run(String(950000000 + n), r.titelnummer, `${kast}-41-${String(n % 30 + 1).padStart(2, '0')}`)
    if (++n >= max) break
  }
  d.exec('COMMIT')
  const nieuw = koppelLosseExemplaren()
  // Demo: wat tips met hoes als "uitgelicht", zodat de homepagina gevuld is.
  run(`UPDATE titels SET uitgelicht = 1 WHERE id IN (SELECT id FROM titels WHERE tip = 1 AND d_hoes IS NOT NULL
        ORDER BY d_jaar DESC, titelnummer DESC LIMIT 24)`)
  console.log(`${n} demo-exemplaren, ${nieuw} titels aangemaakt.`)
}

for (const [email, naam, rollen] of [
  ['beheerder@fonos.demo', 'Eva Visser', ['beheerder', 'redacteur', 'medewerker']],
  ['redacteur@fonos.demo', 'Ruben de Wit', ['redacteur']],
  ['medewerker@fonos.demo', 'Jamie Dekker', ['medewerker']],
] as const) {
  if (!get('SELECT id FROM gebruikers WHERE email = ?', email)) {
    maakGebruiker({ email, naam, rollen: [...rollen], wachtwoord: 'fonos-demo' })
    console.log(`Gebruiker ${email} / wachtwoord: fonos-demo`)
  }
}
