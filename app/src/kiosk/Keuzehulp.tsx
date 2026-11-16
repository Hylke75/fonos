// Keuzehulp "Help me kiezen": vier korte vragen over jezelf (niet over je smaak), daarna meteen een plaat met een
// korte toelichting. Verrassend maar passend: de bezoeker kiest zelf hoe avontuurlijk.
// De kiosk rekent uit de antwoorden een volgorde van genreknoppen uit; de server kiest een beschikbare plaat met hoes
// die op de gekozen speler past (cd op de cd-speler, vinyl op een platenspeler).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { api } from '../api'
import { Hoes } from '../components/Hoes'
import { useKiosk } from './KioskApp'
import type { Kaart } from './Kaarten'
import { t } from './taal'

type Optie = { tekst: string; weging?: Record<string, number>; decennium?: number | null; durf?: number }
type Vraag = { id: string; vraag: string; opties: Optie[] }

// Weging per genreknop (op naam; een knop die beheer anders noemt, telt gewoon niet mee).
const VRAGEN: Vraag[] = [
  { id: 'stemming', vraag: 'Hoe voel je je vandaag?', opties: [
    { tekst: 'Als een kat in de zon', weging: { Jazz: 2, 'Soul & funk': 1, Klassiek: 1 } },
    { tekst: 'Als een flipperkast', weging: { Rock: 2, Elektronisch: 1, HipHop: 1 } },
    { tekst: 'Als een natte krant', weging: { 'Roots & blues': 2, 'Nederlandse muziek': 1, Klassiek: 1 } },
    { tekst: 'Als een toerist zonder kaart', weging: { Wereld: 2, 'Film & musical': 1, Elektronisch: 1 } },
  ] },
  { id: 'dans', vraag: 'Hoe dans jij in de keuken?', opties: [
    { tekst: 'Ik dans niet. Ik knik waarderend.', weging: { Klassiek: 2, Jazz: 1 } },
    { tekst: 'Als een octopus op rolschaatsen', weging: { 'Soul & funk': 2, Pop: 1, HipHop: 1 } },
    { tekst: 'Luchtgitaar met de pollepel', weging: { Rock: 2, 'Roots & blues': 1 } },
    { tekst: 'Ik zing de afwas toe, in het Nederlands', weging: { 'Nederlandse muziek': 2, Pop: 1 } },
  ] },
  { id: 'tijd', vraag: 'Je mag één keer met de tijdmachine. Waarheen?', opties: [
    { tekst: 'Jaren 50', decennium: 1950, weging: { 'Roots & blues': 1, Jazz: 1 } },
    { tekst: 'Jaren 60', decennium: 1960, weging: { Pop: 1, Wereld: 1 } },
    { tekst: 'Jaren 70', decennium: 1970, weging: { 'Soul & funk': 1, Rock: 1 } },
    { tekst: 'Jaren 80', decennium: 1980, weging: { Elektronisch: 1, Pop: 1 } },
  ] },
  { id: 'durf', vraag: 'Hoe verrassend mag het zijn?', opties: [
    { tekst: 'Vertrouwd: iets wat bij me past', durf: 0 },
    { tekst: 'Een beetje verrassend', durf: 1 },
    { tekst: 'Heel verrassend: iets waar ik zelf nooit op zou komen', durf: 2 },
  ] },
]

type Uitslag = { titel: Kaart; stijl: string | null; favoriet: string | null; inDecennium: boolean }

export function Keuzehulp({ onSluit }: { onSluit: () => void }) {
  const { config, spelerSoort } = useKiosk()
  const nav = useNavigate()
  const [antwoorden, setAntwoorden] = useState<Optie[]>([])
  const [uitslag, setUitslag] = useState<Uitslag | null>(null)
  const [fout, setFout] = useState(false)
  const eerder = useRef<number[]>([])
  const eersteKnop = useRef<HTMLButtonElement>(null)
  const stap = antwoorden.length
  const klaar = stap >= VRAGEN.length

  useEffect(() => { eersteKnop.current?.focus() }, [stap, uitslag])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onSluit])

  const zoek = async (a: Optie[]) => {
    setUitslag(null); setFout(false)
    const score = new Map<number, number>()
    for (const k of config.knoppen) score.set(k.id, a.reduce((s, o) => s + (o.weging?.[k.naam] ?? 0), 0) + Math.random() * 0.5)
    const voorkeur = [...score].sort((x, y) => y[1] - x[1]).map(([id]) => id)
    try {
      const r = await api<Uitslag>('/kiosk/keuzehulp', { body: {
        voorkeur, decennium: a.find((o) => o.decennium)?.decennium ?? null, durf: a.find((o) => o.durf != null)?.durf ?? 0, eerder: eerder.current, speler: spelerSoort,
      } })
      eerder.current.push(r.titel.id)
      setUitslag(r)
    } catch { setFout(true) }
  }
  const kies = (o: Optie) => {
    const a = [...antwoorden, o]
    setAntwoorden(a)
    if (a.length >= VRAGEN.length) zoek(a)
  }

  const durf = antwoorden.find((o) => o.durf != null)?.durf ?? 0
  const dec = antwoorden.find((o) => o.decennium)?.decennium
  const wat = !uitslag?.stijl ? '' : `${uitslag.stijl}${uitslag.inDecennium && dec ? t(' uit de jaren {d}', { d: String(dec).slice(2) }) : ''}`
  const toelichting = !uitslag ? '' : !uitslag.stijl || !uitslag.favoriet
    ? t('Een plaat uit de collectie die nu beschikbaar is.')
    : durf === 0 || uitslag.stijl === uitslag.favoriet
      ? t('Past bij je antwoorden: {wat}.', { wat })
      : t('Je antwoorden wijzen naar {favoriet}. Als verrassing: {wat}.', { favoriet: uitslag.favoriet, wat })

  return (
    <div className="modal-achter" role="dialog" aria-modal="true" aria-labelledby="kh-titel" onClick={(e) => e.target === e.currentTarget && onSluit()}>
      <div className="card modal keuzehulp">
        <button className="sluit" onClick={onSluit} aria-label={t('Sluiten')}><X size={22} /></button>
        <div className="kh-kop">{t('Help me kiezen')}</div>
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
        {klaar && !uitslag && !fout && <h2 id="kh-titel">{t('Even zoeken…')}</h2>}
        {klaar && fout && (
          <>
            <h2 id="kh-titel">{t('Dat lukte niet. Probeer het nog eens.')}</h2>
            <div className="knoppen"><button ref={eersteKnop} className="btn btn-pink" onClick={() => zoek(antwoorden)}>{t('Probeer het nog eens')}</button></div>
          </>
        )}
        {uitslag && (
          <>
            <h2 id="kh-titel">{t('Deze plaat past bij jou')}</h2>
            <div className="kh-plaat">
              <Hoes src={uitslag.titel.hoes} alt="" />
              <div>
                <div className="kh-artiest">{uitslag.titel.artiesten || t('Diverse artiesten')}</div>
                <div className="kh-titel">{uitslag.titel.titel}</div>
                <p className="kh-toelichting">{toelichting}</p>
              </div>
            </div>
            <div className="knoppen kh-knoppen">
              <button ref={eersteKnop} className="btn btn-pink" onClick={() => { onSluit(); nav(`/album/${uitslag.titel.id}`) }}>{t('Bekijk deze plaat')}</button>
              <button className="btn btn-ghost" onClick={() => zoek(antwoorden)}>{t('Nog een suggestie')}</button>
              <button className="btn btn-ghost" onClick={() => { setAntwoorden([]); setUitslag(null) }}>{t('Opnieuw beginnen')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
