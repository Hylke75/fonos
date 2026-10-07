// Instellingen (10.10). Open punten staan erbij vermeld.
import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Laden } from '../components/Iconen'
import { Melding, Toggle } from './ui'

type Veld = { k: string; label: string; soort: 'getal' | 'tekst' | 'tijd' | 'lang' | 'keuze' | 'bool'; opties?: [string, string][]; uitleg?: string }
const GROEPEN: { naam: string; velden: Veld[] }[] = [
  { naam: 'Luisterbar', velden: [
    { k: 'aantal_platenspelers', label: 'Aantal platenspelers', soort: 'getal' },
    { k: 'max_titels', label: 'Maximum titels per aanvraag', soort: 'getal', uitleg: 'Open punt O-5: 3 of 5.' },
    { k: 'sluitingstijd', label: 'Sluitingstijd (open aanvragen automatisch afsluiten)', soort: 'tijd', uitleg: 'Vul de openingstijden van Fonos in.' },
    ...(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] as const).map((d) => ({ k: `sluitingstijd_${d}`, label: `Sluitingstijd ${{ ma: 'maandag', di: 'dinsdag', wo: 'woensdag', do: 'donderdag', vr: 'vrijdag', za: 'zaterdag', zo: 'zondag' }[d]}`, soort: 'tijd' as const, uitleg: 'Leeg = de algemene sluitingstijd.' })),
    { k: 'markering_min', label: 'Markering lang openstaande aanvraag (minuten)', soort: 'getal' },
    { k: 'geluid_aan', label: 'Geluidssignaal bij nieuwe aanvraag', soort: 'bool' },
    { k: 'vindcode_bron', label: 'Vindcode', soort: 'keuze', opties: [['titelnummer', 'Catalogusnummer Muziekweb (titelnummer)'], ['objectnummer', 'Objectnummer'], ['veld', 'Apart veld vindcode']], uitleg: 'Open punt O-1: met welke code vindt de medewerker de plaat in het archief?' },
  ] },
  { naam: 'Kiosk', velden: [
    { k: 'speler_inactief_min', label: 'Platenspeler: "Ben je er nog?" na (minuten zonder gebruik)', soort: 'getal' },
    { k: 'speler_reactie_min', label: 'Platenspeler: automatisch vrijgeven na (minuten zonder reactie)', soort: 'getal' },
    { k: 'inactiviteit_sec', label: 'Zonder gekozen platenspeler: sessie wissen na (seconden)', soort: 'getal' },
    { k: 'waarschuwing_sec', label: 'Zonder gekozen platenspeler: waarschuwing vooraf (seconden)', soort: 'getal' },
    { k: 'bevestiging_sec', label: 'Duur bevestigingsscherm (seconden)', soort: 'getal' },
    { k: 'vaak_periode_dagen', label: 'Periode "Vaak aangevraagd" (dagen)', soort: 'getal' },
    { k: 'spotify_aan', label: 'Spotify-speler en QR-code op de albumpagina', soort: 'bool', uitleg: 'Ook het menu Spotify-koppelingen. Bestaande koppelingen blijven bewaard.' },
    { k: 'bumper_video_url', label: 'Bumper op het rustscherm (adres van de video)', soort: 'tekst', uitleg: 'Leeg = het welkomstscherm "De Fonotheek".' },
  ] },
  { naam: 'Nieuwsbrief en privacy', velden: [
    { k: 'privacy_tekst', label: 'Privacytekst', soort: 'lang' },
    { k: 'privacy_url', label: 'Link naar de privacyverklaring', soort: 'tekst' },
    { k: 'nieuwsbrief_koppeling', label: 'Nieuwsbriefsysteem', soort: 'keuze', opties: [['beheer', 'Bewaren in de beheeromgeving (menu Nieuwsbrief)'], ['webhook', 'Webhook (POST met e-mail, naam, bron)'], ['geen', 'Geen aanmelding in de kiosk']], uitleg: 'Open punt O-4. Bij "bewaren" exporteert een beheerder de aanmeldingen als CSV naar het nieuwsbriefsysteem.' },
    { k: 'nieuwsbrief_url', label: 'Webhook-adres', soort: 'tekst' },
    { k: 'nieuwsbrief_bron', label: 'Bron die wordt meegegeven', soort: 'tekst' },
    { k: 'nieuwsbrief_bewaar_dagen', label: 'Aanmeldingen verwijderen na export (dagen)', soort: 'getal', uitleg: '0 = niet automatisch verwijderen.' },
  ] },
  { naam: 'Meldingen', velden: [
    { k: 'melding_email_aan', label: 'E-mail bij elke nieuwe aanvraag', soort: 'bool', uitleg: 'Open punt O-9, standaard uit.' },
    { k: 'melding_email_adres', label: 'E-mailadres voor meldingen', soort: 'tekst' },
  ] },
  { naam: 'Beveiliging (IT-beleid B&G)', velden: [
    { k: 'tweestaps', label: 'Tweestapsverificatie (code uit een authenticator-app)', soort: 'keuze', opties: [['iedereen', 'Verplicht voor iedereen'], ['beheerders', 'Verplicht voor beheerders'], ['uit', 'Niet verplicht']], uitleg: 'IT-beleid 6.1: alleen een wachtwoord is niet afdoende. Inloggen via Google telt al als tweestaps.' },
    { k: 'wachtwoord_inloggen', label: 'Inloggen met e-mail en wachtwoord toestaan', soort: 'bool', uitleg: 'Uit = alleen inloggen via Google (de IDP). Kan pas uit als inloggen via Google is ingesteld.' },
    { k: 'beheer_meldingen_adres', label: 'Extra adressen voor storingsmeldingen', soort: 'tekst', uitleg: 'IT-beleid 6.2: naast alle beheerders, bijvoorbeeld de Topdesk-mailbox. Meerdere adressen met komma’s.' },
    { k: 'aanmeldingen_bewaar_dagen', label: 'Log van aanmeldingen bewaren (dagen)', soort: 'getal', uitleg: '0 = niet automatisch verwijderen.' },
    { k: 'account_herinnering_dagen', label: 'Herinnering vóór de einddatum van een account (dagen)', soort: 'getal', uitleg: 'IT-beleid 8.4: de gebruiker en de beheerders krijgen een e-mail; verlenging gaat via HR.' },
  ] },
  { naam: 'Back-ups', velden: [
    { k: 'backup_tijd', label: 'Tijdstip nachtelijke back-up', soort: 'tijd' },
    { k: 'backup_bewaar_dagelijks', label: 'Aantal dagelijkse back-ups bewaren', soort: 'getal', uitleg: 'Open punt O-8: aan te passen aan het IT-beleid van B&G.' },
    { k: 'backup_bewaar_maandelijks', label: 'Aantal maanden één back-up per maand bewaren', soort: 'getal' },
    { k: 'backup_bewaar_handmatig_dagen', label: 'Handmatige back-ups bewaren (dagen)', soort: 'getal', uitleg: 'Ook back-ups vóór terugzetten. Downloadbestanden worden na een dag verwijderd.' },
  ] },
]

export function Instellingen() {
  const [i, setI] = useState<any>(null)
  const [orig, setOrig] = useState<any>(null)
  const [m, setM] = useState<any>(null)
  useEffect(() => { api('/beheer/instellingen').then((r) => { setI(r.instellingen); setOrig(r.instellingen) }) }, [])
  if (!i) return <Laden />
  const gewijzigd = JSON.stringify(i) !== JSON.stringify(orig)
  const bewaar = async () => {
    setM(null)
    const diff = Object.fromEntries(Object.entries(i).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(orig[k])))
    try { const r = await api('/beheer/instellingen', { method: 'PUT', body: diff }); setI(r.instellingen); setOrig(r.instellingen); setM({ soort: 'ok', tekst: 'Instellingen opgeslagen.' }) } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1>Instellingen</h1>
        <button className="btn btn-cyan" style={{ marginLeft: 'auto' }} disabled={!gewijzigd} onClick={bewaar}>Opslaan</button>
      </div>
      <Melding m={m} />
      {GROEPEN.map((g) => (
        <div key={g.naam} className="card paneel">
          <h2 style={{ marginTop: 0 }}>{g.naam}</h2>
          <div className="drie-kol" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {g.velden.map((v) => (
              <label key={v.k} className="veld" style={v.soort === 'lang' ? { gridColumn: '1 / -1' } : undefined}>
                <span>{v.label}</span>
                {v.soort === 'getal' && <input type="number" min={0} value={i[v.k]} onChange={(e) => setI({ ...i, [v.k]: Number(e.target.value) })} />}
                {v.soort === 'tekst' && <input value={i[v.k]} onChange={(e) => setI({ ...i, [v.k]: e.target.value })} />}
                {v.soort === 'tijd' && <input type="time" value={i[v.k]} onChange={(e) => setI({ ...i, [v.k]: e.target.value })} />}
                {v.soort === 'lang' && <textarea value={i[v.k]} onChange={(e) => setI({ ...i, [v.k]: e.target.value })} />}
                {v.soort === 'keuze' && <select value={i[v.k]} onChange={(e) => setI({ ...i, [v.k]: e.target.value })}>{v.opties!.map(([w, l]) => <option key={w} value={w}>{l}</option>)}</select>}
                {v.soort === 'bool' && <Toggle aan={!!i[v.k]} onChange={(b) => setI({ ...i, [v.k]: b })} label={i[v.k] ? 'Aan' : 'Uit'} />}
                {v.uitleg && <span className="dim tekst-klein">{v.uitleg}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="card paneel">
        <h2 style={{ marginTop: 0 }}>Toegestane fonos.nl-pagina's ("Lezen tijdens het luisteren")</h2>
        <p className="muted tekst-klein">Zet dezelfde adressen ook op de lijst van toegestane adressen in de kioskbrowser.</p>
        {i.fonos_paginas.map((p: any, n: number) => (
          <div key={n} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 44px', gap: 8, marginBottom: 8 }}>
            <input className="invoer" value={p.naam} onChange={(e) => setI({ ...i, fonos_paginas: i.fonos_paginas.map((x: any, k: number) => (k === n ? { ...x, naam: e.target.value } : x)) })} placeholder="Naam" />
            <input className="invoer" value={p.url} onChange={(e) => setI({ ...i, fonos_paginas: i.fonos_paginas.map((x: any, k: number) => (k === n ? { ...x, url: e.target.value } : x)) })} placeholder="https://www.fonos.nl/…" />
            <button className="menu-knop" aria-label="Verwijderen" onClick={() => setI({ ...i, fonos_paginas: i.fonos_paginas.filter((_: any, k: number) => k !== n) })}><Trash2 size={16} /></button>
          </div>
        ))}
        <button className="btn btn-ghost btn-s" onClick={() => setI({ ...i, fonos_paginas: [...i.fonos_paginas, { naam: '', url: 'https://www.fonos.nl/' }] })}><Plus size={14} /> Pagina toevoegen</button>
      </div>
    </>
  )
}
