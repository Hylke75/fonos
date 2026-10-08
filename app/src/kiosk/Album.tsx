// Albumpagina (7.6). Populair en klassiek; bij klassiek componisten en uitvoerenden waar de dump die levert.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, RotateCw, Sparkles, X } from 'lucide-react'
import { api, ApiFout } from '../api'
import { Hoes } from '../components/Hoes'
import { Laden, SpeelIcoon } from '../components/Iconen'
import { useKiosk } from './KioskApp'
import { KioskKopTerug } from './Kop'
import { AlbumKaart, type Kaart } from './Kaarten'
import { huidigeTaal, t } from './taal'

type Ex = { exemplaar_id: number; titel_id: number; drager: string | null; jaar: number | null; vindcode: string | null; beschikbaar: boolean; deze_titel: boolean }
export type AlbumData = {
  id: number; titelnummer: string | null; soort: string; jaar: number | null; fonos_verhaal: string | null; ai_tekst: boolean; beschikbaar: boolean; spotify_album_id?: string | null
  velden: { titel?: string; artiesten?: string[]; uitgave?: string; drager?: string; aantal?: number; label?: string; genres?: string[]; speelduur?: string; toelichting?: string; tracklist?: { pos: number; titel: string; duur?: string | null; componisten?: string[]; uitvoerenden?: string[] }[]; hoes_voor?: string; hoes_achter?: string; componisten?: string[]; uitvoerenden?: string[] }
  exemplaren: Ex[]
}

const uitgaveTekst = (u?: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(u ?? '')
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(huidigeTaal() === 'en' ? 'en-GB' : 'nl-NL', { month: 'long', year: 'numeric' })
  if (huidigeTaal() === 'en' && /^voor 1988$/i.test(u ?? '')) return 'before 1988'
  return u ?? ''
}
const dragerTekst = (d?: string | null, n?: number) => (d ? `${n && n > 1 ? `${n} × ` : ''}${d === 'Overig' ? (huidigeTaal() === 'en' ? 'other' : 'overig') : d}` : '')

export function Album() {
  const { id } = useParams()
  const [a, setA] = useState<AlbumData | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const { versie } = useKiosk()
  useEffect(() => {
    setFout(null)
    api<AlbumData>(`/kiosk/titel/${id}`).then(setA).catch((e: ApiFout) => setFout(t(e.message)))
  }, [id, versie])
  return (
    <div className="kiosk-scherm">
      <KioskKopTerug />
      <main className="kiosk-inhoud">
        {fout && <div className="leeg"><h2>{fout}</h2></div>}
        {!a && !fout && <Laden />}
        {a && <AlbumWeergave a={a} />}
      </main>
    </div>
  )
}

/** Ook gebruikt als voorbeeldweergave in het beheer. */
export function AlbumWeergave({ a, voorbeeld = false }: { a: AlbumData; voorbeeld?: boolean }) {
  const v = a.velden
  const nav = useNavigate()
  const ctx = useKiosk()
  const kiosk = voorbeeld ? null : ctx
  const geenNummers = !(v.tracklist?.length)
  // Zonder tracklist (bij veel popalbums levert Muziekweb die niet): de gegevens meteen tonen.
  const [meer, setMeer] = useState(geenNummers)
  useEffect(() => setMeer(geenNummers), [a.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [achter, setAchter] = useState(false)
  const eerste = a.exemplaren.find((e) => e.deze_titel && e.beschikbaar) ?? a.exemplaren.find((e) => e.beschikbaar)
  const [keuze, setKeuze] = useState<number | undefined>(eerste?.exemplaar_id)
  useEffect(() => setKeuze(eerste?.exemplaar_id), [a.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const gekozen = a.exemplaren.find((e) => e.exemplaar_id === keuze && e.beschikbaar)
  const inMand = kiosk?.mand.some((m) => m.titel_id === gekozen?.titel_id)
  const klassiek = a.soort === 'klassiek'
  const personen = klassiek && v.componisten?.length ? v.componisten : v.artiesten ?? []
  const vol = kiosk && kiosk.mand.length >= kiosk.config.instellingen.max_titels && !inMand

  const voegToe = () => {
    if (!kiosk || !gekozen) return
    const ok = kiosk.voegToe({
      titel_id: gekozen.titel_id, exemplaar_id: gekozen.exemplaar_id, titel: v.titel ?? '', artiesten: (v.artiesten ?? []).join(', '),
      drager: gekozen.drager, jaar: gekozen.jaar, hoes: v.hoes_voor, vindcode: gekozen.vindcode,
    })
    if (ok) kiosk.toast(t('{titel} staat in je aanvraag', { titel: v.titel ?? '' }))
  }

  return (
    <div className="album-grid">
      <div>
        <div className="album-hoes"><Hoes src={achter ? v.hoes_achter : v.hoes_voor} alt={achter ? t('Achterzijde van de hoes') : t('Hoes')} groot /></div>
        {v.hoes_achter && (
          <button className="btn btn-ghost btn-s" style={{ marginTop: 14, minHeight: 44 }} onClick={() => setAchter(!achter)}>
            <RotateCw size={16} /> {achter ? t('Toon voorzijde') : t('Toon achterzijde')}
          </button>
        )}
      </div>

      <div className="album-info">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {personen.length === 0 && <span className="artiest">{t('Diverse artiesten')}</span>}
          {personen.slice(0, 4).map((p, i) => (
            <button key={p} className="artiest" onClick={() => !voorbeeld && nav(`/artiest/${encodeURIComponent(p)}`)}>{p}{i < Math.min(personen.length, 4) - 1 ? ',' : ''}</button>
          ))}
        </div>
        <h1>{v.titel}</h1>
        <div className="tags">
          {(a.jaar || v.uitgave) && <span className="pill">{a.jaar ?? uitgaveTekst(v.uitgave)}</span>}
          {(v.genres ?? []).slice(0, 2).map((g) => <span key={g} className="pill">{g}</span>)}
          {v.drager && <span className="pill">{dragerTekst(v.drager, v.aantal)}</span>}
        </div>
        {v.toelichting && (
          <>
            {a.ai_tekst && <div className="ai-label"><Sparkles size={14} /> {t('Tekst gegenereerd met AI')}</div>}
            <div className={`toelichting ${meer ? '' : 'kort'}`}>{v.toelichting}</div>
          </>
        )}
        <button className="btn btn-ghost btn-s" style={{ marginTop: 22, minHeight: 48, padding: '0 22px' }} onClick={() => setMeer(!meer)} aria-expanded={meer}>
          {t('Meer informatie')} {meer ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {meer && (
          <>
            <dl className="meer-info">
              {klassiek && v.componisten?.length ? <><dt>{t('Componist(en)')}</dt><dd>{v.componisten.join(', ')}</dd></> : null}
              {klassiek && v.uitvoerenden?.length ? <><dt>{t('Uitvoerenden')}</dt><dd>{v.uitvoerenden.slice(0, 12).join(', ')}{v.uitvoerenden.length > 12 ? ' …' : ''}</dd></> : null}
              {klassiek && v.artiesten?.length ? <><dt>{t('Op de hoes')}</dt><dd>{v.artiesten.join(', ')}</dd></> : null}
              {v.uitgave && <><dt>{t('Uitgebracht')}</dt><dd>{uitgaveTekst(v.uitgave)}</dd></>}
              {v.genres?.length ? <><dt>{t('Genres')}</dt><dd>{v.genres.join(', ')}</dd></> : null}
              {v.label && <><dt>{t('Label')}</dt><dd>{v.label}</dd></>}
              {v.drager && <><dt>{t('Drager')}</dt><dd>{dragerTekst(v.drager, v.aantal)}</dd></>}
              {v.speelduur && <><dt>{t('Speelduur')}</dt><dd>{v.speelduur}</dd></>}
            </dl>
            {a.fonos_verhaal && <div className="fonos-verhaal"><h3>{t('Het verhaal van Fonos')}</h3>{a.fonos_verhaal}</div>}
          </>
        )}
        {!meer && a.fonos_verhaal && <div className="fonos-verhaal"><h3>{t('Het verhaal van Fonos')}</h3>{a.fonos_verhaal}</div>}

        {(v.tracklist?.length ?? 0) > 0 && (
          <section className="nummers">
            <h2>{t('Nummers')}</h2>
            {v.tracklist!.map((t, i) => (
              <div className="nummer" key={i}>
                <span className="speel" aria-hidden="true"><SpeelIcoon /></span>
                <span className="nr">{t.pos}</span>
                <span>{t.titel}{klassiek && (t.componisten?.length || t.uitvoerenden?.length) ? <span className="sub">{[t.componisten?.join(', '), t.uitvoerenden?.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</span> : null}</span>
                <span className="duur">{t.duur ?? ''}</span>
              </div>
            ))}
          </section>
        )}
        {geenNummers && <p className="muted tekst-klein geen-nummers">{t('Van deze plaat is geen lijst met nummers bekend.')}</p>}
        {a.spotify_album_id && <SpotifyBlok id={a.spotify_album_id} />}
        {!voorbeeld && <OokLuisteren id={a.id} />}
      </div>

      <div className="exemplaren-kolom">
        <div className="card exemplaren-paneel">
          <h2>{t('Beschikbare exemplaren')}</h2>
          {a.exemplaren.length === 0 && <p className="muted">{t('Geen exemplaren in de collectie.')}</p>}
          {a.exemplaren.map((e) => (
            <button key={e.exemplaar_id} className={`exemplaar ${keuze === e.exemplaar_id ? 'gekozen' : ''}`} disabled={!e.beschikbaar}
              onClick={() => setKeuze(e.exemplaar_id)} role="radio" aria-checked={keuze === e.exemplaar_id}>
              <span className="radio">{keuze === e.exemplaar_id && <SpeelIcoon />}</span>
              <span>
                <div className="wat">{e.drager ?? ''} {e.jaar ?? ''}{!e.deze_titel ? t(' (andere uitgave)') : ''}</div>
                <div className="code">{t(ctx.config.instellingen.vindcode_label)}: {e.vindcode ?? '–'}</div>
                {!e.beschikbaar && <div className="in-gebruik">{t('In gebruik')}</div>}
              </span>
              <span className={`stip ${e.beschikbaar ? 'ja' : 'nee'}`} aria-label={e.beschikbaar ? t('Beschikbaar') : t('In gebruik')}>
                {!e.beschikbaar && <X size={12} strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
        {!voorbeeld && (
          <div className="paneel-knop">
            <button className="btn btn-pink btn-l btn-block" disabled={!gekozen || inMand || !!vol} onClick={voegToe}>
              {inMand ? t('Staat in je aanvraag') : gekozen ? t('Voeg toe aan aanvraag') : t('Nu in gebruik')}
            </button>
            {vol && gekozen && (
              <>
                <button className="btn btn-ghost btn-l btn-block" style={{ marginTop: 10 }} disabled={kiosk!.bewaard.some((b) => b.titel_id === gekozen.titel_id)}
                  onClick={() => kiosk!.bewaar({ titel_id: gekozen.titel_id, exemplaar_id: gekozen.exemplaar_id, titel: v.titel ?? '', artiesten: (v.artiesten ?? []).join(', '), drager: gekozen.drager, jaar: gekozen.jaar, hoes: v.hoes_voor, vindcode: gekozen.vindcode })}>
                  {kiosk!.bewaard.some((b) => b.titel_id === gekozen.titel_id) ? t('Bewaard voor later') : t('Bewaar voor later')}
                </button>
                <p className="melding">{t('Je aanvraag is vol: maximaal {n} titels. Bewaar deze plaat voor je volgende aanvraag.', { n: kiosk!.config.instellingen.max_titels })}</p>
              </>
            )}
            {inMand && <p className="melding"><button className="link-terug" style={{ margin: '0 auto', color: 'var(--cyan)' }} onClick={() => nav('/aanvraag')}>{t('Naar je aanvraag')}</button></p>}
          </div>
        )}
      </div>
    </div>
  )
}

/** "Ook luisteren": andere beschikbare platen van dezelfde artiest en in dezelfde stijl. */
function OokLuisteren({ id }: { id: number }) {
  const [d, setD] = useState<{ artiest: Kaart[]; stijl: Kaart[]; stijlnaam: string | null } | null>(null)
  useEffect(() => { setD(null); api(`/kiosk/titel/${id}/ook`).then(setD).catch(() => setD(null)) }, [id])
  if (!d || (!d.artiest.length && !d.stijl.length)) return null
  return (
    <>
      {d.artiest.length > 0 && (
        <section className="ook-luisteren" aria-label={t('Meer van deze artiest')}>
          <h2>{t('Meer van deze artiest')}</h2>
          <div className="rij">{d.artiest.map((k) => <AlbumKaart key={k.id} k={k} />)}</div>
        </section>
      )}
      {d.stijl.length > 0 && (
        <section className="ook-luisteren" aria-label={t('Ook luisteren')}>
          <h2>{d.stijlnaam ? t('Ook luisteren: {stijl}', { stijl: d.stijlnaam }) : t('Ook luisteren')}</h2>
          <div className="rij">{d.stijl.map((k) => <AlbumKaart key={k.id} k={k} />)}</div>
        </section>
      )}
    </>
  )
}

/** Spotify-speler en QR-code naar het album op de eigen telefoon. Alleen bij een goedgekeurde koppeling.
 *  Kioskmodus: de sandbox staat geen pop-ups en geen navigatie van de app toe, dus de speler kan de kiosk niet laten wegnavigeren. */
function SpotifyBlok({ id }: { id: string }) {
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    let weg = false
    import('qrcode').then((Q) => Q.toString(`https://open.spotify.com/album/${id}`, { type: 'svg', margin: 1, width: 160, color: { dark: '#040a1e', light: '#ffffff' } }))
      .then((svg) => { if (!weg) setQr(svg) }).catch(() => {})
    return () => { weg = true }
  }, [id])
  return (
    <section className="spotify-blok" aria-label={t('Luister via Spotify')}>
      <h2>{t('Luister via Spotify')}</h2>
      <div className="card spotify-kaart">
        <div className="spotify-speler">
          <iframe
            title="Spotify-speler"
            src={`https://open.spotify.com/embed/album/${id}?utm_source=generator&theme=0`}
            height={152} loading="lazy"
            allow="encrypted-media; autoplay"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <div className="spotify-qr">
          {qr ? <div className="code" dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="code" />}
          <div>
            <div className="wat">{t('Scan om dit album op je telefoon te openen')}</div>
            <div className="uitleg">{t('Luister het hele album in de Spotify-app.')}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
