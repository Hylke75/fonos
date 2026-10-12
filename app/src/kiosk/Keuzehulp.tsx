// Keuzehulp "Dokter Vinyl": vier rare vragen over jezelf (niet over je smaak), een recept met diagnose,
// en dan de plaat uitpakken als een blind date. Verrassend maar passend: de bezoeker kiest zelf hoe avontuurlijk.
// De kiosk rekent uit de antwoorden een volgorde van genreknoppen uit; de server kiest een beschikbare plaat met hoes.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gift, Stethoscope, X } from 'lucide-react'
import { api } from '../api'
import { Hoes } from '../components/Hoes'
import { useKiosk } from './KioskApp'
import type { Kaart } from './Kaarten'
import { t } from './taal'

type Optie = { tekst: string; weging?: Record<string, number>; decennium?: number | null; durf?: number; kwaal?: string }
type Vraag = { id: string; vraag: string; opties: Optie[] }

// Weging per genreknop (op naam; een knop die beheer anders noemt, telt gewoon niet mee).
const VRAGEN: Vraag[] = [
  { id: 'stemming', vraag: 'Hoe voel je je vandaag?', opties: [
    { tekst: 'Als een kat in de zon', weging: { Jazz: 2, 'Soul & funk': 1, Klassiek: 1 }, kwaal: 'Zondagmiddagsyndroom' },
    { tekst: 'Als een flipperkast', weging: { Rock: 2, Elektronisch: 1, HipHop: 1 }, kwaal: 'Acute stuiterigheid' },
    { tekst: 'Als een natte krant', weging: { 'Roots & blues': 2, 'Nederlandse muziek': 1, Klassiek: 1 }, kwaal: 'Chronische weemoed' },
    { tekst: 'Als een toerist zonder kaart', weging: { Wereld: 2, 'Film & musical': 1, Elektronisch: 1 }, kwaal: 'Ernstige reiskriebels' },
  ] },
  { id: 'dans', vraag: 'Hoe dans jij in de keuken?', opties: [
    { tekst: 'Ik dans niet. Ik knik waarderend.', weging: { Klassiek: 2, Jazz: 1 } },
    { tekst: 'Als een octopus op rolschaatsen', weging: { 'Soul & funk': 2, Pop: 1, HipHop: 1 } },
    { tekst: 'Luchtgitaar met de pollepel', weging: { Rock: 2, 'Roots & blues': 1 } },
    { tekst: 'Ik zing de afwas toe, in het Nederlands', weging: { 'Nederlandse muziek': 2, Pop: 1 } },
  ] },
  { id: 'tijd', vraag: 'Je mag één keer met de tijdmachine. Waarheen?', opties: [
    { tekst: 'Jaren 50: brillantine en bandrecorders', decennium: 1950, weging: { 'Roots & blues': 1, Jazz: 1 } },
    { tekst: 'Jaren 60: bloemen in het haar', decennium: 1960, weging: { Pop: 1, Wereld: 1 } },
    { tekst: 'Jaren 70: wijde pijpen, wijde gedachten', decennium: 1970, weging: { 'Soul & funk': 1, Rock: 1 } },
    { tekst: 'Jaren 80: schoudervullingen tot het plafond', decennium: 1980, weging: { Elektronisch: 1, Pop: 1 } },
  ] },
  { id: 'durf', vraag: 'Hoe pittig mag het recept zijn?', opties: [
    { tekst: 'Mild graag, ik heb een gevoelige maag', durf: 0 },
    { tekst: 'Pittig: verras me een beetje', durf: 1 },
    { tekst: 'Extra heet: iets waar ik zelf nooit op zou komen', durf: 2 },
  ] },
]

const BIJSLUITERS = [
  'Bijwerkingen: spontaan meeneuriën en voetjes van de vloer.',
  'Niet gebruiken tijdens het besturen van zware machines, behalve een platenspeler.',
  'Werkt het niet? Dan heb je een prima excuus voor een tweede plaat.',
  'Buiten bereik van kinderen bewaren. Of juist niet, dat mag je zelf weten.',
]

type Uitslag = { titel: Kaart; stijl: string | null; favoriet: string | null; inDecennium: boolean }

const GEVRAAGD = 'fonos-keuzehulp'
const alGevraagd = () => { try { return !!sessionStorage.getItem(GEVRAAGD) } catch { return false } }
/** Na de uitnodiging of de knop "Help me kiezen": deze sessie geen uitnodiging (meer). */
export const keuzehulpGevraagd = () => { try { sessionStorage.setItem(GEVRAAGD, '1') } catch { /* geen opslag */ } }

/** Na 6 seconden op de homepagina één keer per sessie een uitnodiging; niet als de bezoeker al aan het zoeken is. */
export function KeuzehulpUitnodiging() {
  const [zien, setZien] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (alGevraagd()) return
    const tm = setTimeout(() => {
      if (alGevraagd()) return // intussen zelf op "Help me kiezen" getikt
      if (document.activeElement instanceof HTMLInputElement) return // bezoeker typt al in de zoekbalk
      keuzehulpGevraagd()
      setZien(true)
    }, 6000)
    return () => clearTimeout(tm)
  }, [])
  useEffect(() => { // na 20 seconden zonder reactie weer weg
    if (!zien) return
    const tm = setTimeout(() => setZien(false), 20000)
    return () => clearTimeout(tm)
  }, [zien])
  return (
    <>
      {zien && (
        <div className="card keuzehulp-uitnodiging" role="dialog" aria-labelledby="kh-uitnodiging">
          <button className="sluit" onClick={() => setZien(false)} aria-label={t('Sluiten')}><X size={20} /></button>
          <div className="kh-icoon" aria-hidden="true"><Stethoscope size={26} /></div>
          <div>
            <h2 id="kh-uitnodiging">{t('Hulp nodig bij het kiezen?')}</h2>
            <p>{t('Dokter Vinyl stelt je vier rare vragen en schrijft je een plaat voor. Bijwerkingen: spontaan meeneuriën.')}</p>
            <div className="knoppen">
              <button className="btn btn-pink" onClick={() => { setZien(false); setOpen(true) }}>{t('Ja, help me kiezen')}</button>
              <button className="btn btn-ghost" onClick={() => setZien(false)}>{t('Nee, ik red me wel')}</button>
            </div>
          </div>
        </div>
      )}
      {open && <Keuzehulp onSluit={() => setOpen(false)} />}
    </>
  )
}

export function Keuzehulp({ onSluit }: { onSluit: () => void }) {
  const { config } = useKiosk()
  const nav = useNavigate()
  const [antwoorden, setAntwoorden] = useState<Optie[]>([])
  const [uitslag, setUitslag] = useState<Uitslag | null>(null)
  const [fout, setFout] = useState(false)
  const [uitgepakt, setUitgepakt] = useState(false)
  const [bijsluiter] = useState(() => BIJSLUITERS[Math.floor(Math.random() * BIJSLUITERS.length)])
  const eerder = useRef<number[]>([])
  const eersteKnop = useRef<HTMLButtonElement>(null)
  const stap = antwoorden.length
  const klaar = stap >= VRAGEN.length

  useEffect(() => { eersteKnop.current?.focus() }, [stap, uitslag, uitgepakt])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onSluit])

  const schrijfVoor = async (a: Optie[]) => {
    setUitslag(null); setUitgepakt(false); setFout(false)
    const score = new Map<number, number>()
    for (const k of config.knoppen) score.set(k.id, a.reduce((s, o) => s + (o.weging?.[k.naam] ?? 0), 0) + Math.random() * 0.5)
    const voorkeur = [...score].sort((x, y) => y[1] - x[1]).map(([id]) => id)
    try {
      const r = await api<Uitslag>('/kiosk/keuzehulp', { body: { voorkeur, decennium: a.find((o) => o.decennium)?.decennium ?? null, durf: a.find((o) => o.durf != null)?.durf ?? 0, eerder: eerder.current } })
      eerder.current.push(r.titel.id)
      setUitslag(r)
    } catch { setFout(true) }
  }
  const kies = (o: Optie) => {
    const a = [...antwoorden, o]
    setAntwoorden(a)
    if (a.length >= VRAGEN.length) schrijfVoor(a)
  }

  const kwaal = antwoorden.find((o) => o.kwaal)?.kwaal ?? 'Platenhonger'
  const durf = antwoorden.find((o) => o.durf != null)?.durf ?? 0
  const dec = antwoorden.find((o) => o.decennium)?.decennium
  const stijl = uitslag?.stijl ?? t('iets onverwachts')
  const toelichting = !uitslag ? '' : !uitslag.stijl || !uitslag.favoriet ? t('De dokter gooide zijn kaartenbak om en greep blind. Vertrouw hem maar.')
    : uitslag.stijl === uitslag.favoriet || durf === 0
    ? t('Precies wat de dokter dacht: {stijl}.', { stijl: uitslag.stijl })
    : durf === 1
      ? t('Je wilde het pittig. Dus niet je favoriet {favoriet}, maar {stijl}, en een plaat die bijna niemand aanvraagt.', { favoriet: uitslag.favoriet, stijl: uitslag.stijl })
      : t('Extra heet besteld. Je antwoorden roepen {favoriet}, dus schrijf ik juist {stijl} voor.', { favoriet: uitslag.favoriet, stijl: uitslag.stijl })

  return (
    <div className="modal-achter" role="dialog" aria-modal="true" aria-labelledby="kh-titel" onClick={(e) => e.target === e.currentTarget && onSluit()}>
      <div className="card modal keuzehulp">
        <button className="sluit" onClick={onSluit} aria-label={t('Sluiten')}><X size={22} /></button>
        <div className="kh-kop"><Stethoscope size={20} aria-hidden="true" /> {t('Dokter Vinyl')}</div>
        {!klaar && (
          <>
            <div className="kh-voortgang" role="img" aria-label={t('Vraag {n} van {m}', { n: stap + 1, m: VRAGEN.length })}>
              {VRAGEN.map((v, i) => <span key={v.id} className={i < stap ? 'af' : i === stap ? 'nu' : ''} />)}
            </div>
            <h2 id="kh-titel">{t(VRAGEN[stap].vraag)}</h2>
            <div className="kh-opties">
              {VRAGEN[stap].opties.map((o, i) => <button key={o.tekst} ref={i === 0 ? eersteKnop : undefined} className="kh-optie" onClick={() => kies(o)}>{t(o.tekst)}</button>)}
            </div>
          </>
        )}
        {klaar && !uitslag && !fout && <><h2 id="kh-titel">{t('De dokter denkt na…')}</h2><p className="muted">{t('Even in de kaartenbak kijken.')}</p></>}
        {klaar && fout && (
          <>
            <h2 id="kh-titel">{t('De dokter is even zijn stethoscoop kwijt.')}</h2>
            <div className="knoppen"><button ref={eersteKnop} className="btn btn-pink" onClick={() => schrijfVoor(antwoorden)}>{t('Probeer het nog eens')}</button></div>
          </>
        )}
        {uitslag && (
          <>
            <div className="kh-recept">
              <div className="kh-recept-kop">{t('Recept')}</div>
              <h2 id="kh-titel">{t('Diagnose: {kwaal}', { kwaal: t(kwaal) })}</h2>
              <p>{toelichting}</p>
              <p className="kh-voorschrift">{t('Voorschrift: {stijl}{decennium}. Eén kant per keer, met de ogen dicht.', {
                stijl, decennium: uitslag.inDecennium && dec ? t(' uit de jaren {d}', { d: String(dec).slice(2) }) : '' })}</p>
              <p className="kh-bijsluiter">{t(bijsluiter)}</p>
            </div>
            {!uitgepakt ? (
              <button ref={eersteKnop} className="kh-pakket" onClick={() => setUitgepakt(true)}>
                <Gift size={28} aria-hidden="true" />
                <span><b>{t('Pak je plaat uit')}</b><br /><span className="kh-hint">{t('Hint: {stijl}', { stijl })}{uitslag.titel.jaar ? `, ${uitslag.titel.jaar}` : ''}</span></span>
              </button>
            ) : (
              <div className="kh-plaat">
                <Hoes src={uitslag.titel.hoes} alt="" />
                <div>
                  <div className="kh-artiest">{uitslag.titel.artiesten || t('Diverse artiesten')}</div>
                  <div className="kh-titel">{uitslag.titel.titel}</div>
                  <div className="knoppen">
                    <button ref={eersteKnop} className="btn btn-pink" onClick={() => { onSluit(); nav(`/album/${uitslag.titel.id}`) }}>{t('Bekijk deze plaat')}</button>
                    <button className="btn btn-ghost" onClick={() => schrijfVoor(antwoorden)}>{t('Nog een recept')}</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
