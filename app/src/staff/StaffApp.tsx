// Medewerkersscherm (9): aanvragen realtime, ophalen, uitgeven, vrijgeven, annuleren; platenspelers (in)actief.
import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Clock, LogOut, X } from 'lucide-react'
import { api, ApiFout, tijd } from '../api'
import { useVersies } from '../versies'
import { Logo } from '../components/Logo'
import { Hoes } from '../components/Hoes'
import { Laden } from '../components/Iconen'
import { Afgeschermd, initialen, type Ik } from '../Login'

const STATUS: Record<string, string> = { nieuw: 'Nieuw', bezig: 'Bezig', klaar: 'Klaar', afgesloten: 'Afgesloten', geannuleerd: 'Geannuleerd' }

/** Kort geluidssignaal bij een nieuwe aanvraag. */
function piep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    for (const [f, t] of [[880, 0], [1320, 0.18]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = f; o.type = 'sine'
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3)
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32)
    }
  } catch { /* geen geluid mogelijk */ }
}

/** Realtime: verversen zodra de aanvragen veranderen; bij een nieuwe aanvraag het bestelnummer. */
function useRealtime(opNieuw: (d: { nieuw?: number | null }) => void) {
  useVersies((v, oud) => opNieuw({ nieuw: v.aanvragen !== oud.aanvragen && v.laatste_nieuw !== oud.laatste_nieuw ? v.laatste_nieuw : null }), 3000)
}

export function StaffApp() {
  return (
    <Afgeschermd titel="Medewerkersscherm" rollen={['medewerker', 'beheerder']}>
      {(ik, uit) => (
        <div className="app-scherm">
          <StafKop ik={ik} uit={uit} />
          <div className="staf-inhoud">
            <Routes>
              <Route path="/" element={<Lijst />} />
              <Route path="/aanvraag/:id" element={<Detail />} />
            </Routes>
          </div>
        </div>
      )}
    </Afgeschermd>
  )
}

function StafKop({ ik, uit }: { ik: Ik; uit: () => void }) {
  const [menu, setMenu] = useState(false)
  return (
    <header className="staf-header">
      <Logo />
      <div style={{ position: 'relative' }}>
        <button className="gebruiker" onClick={() => setMenu(!menu)} aria-expanded={menu}>Medewerker <span className="avatar" title={ik.naam}>{initialen(ik.naam)}</span></button>
        {menu && <div className="popmenu" style={{ top: 52 }}><div className="dim tekst-klein" style={{ padding: '8px 12px' }}>{ik.naam}</div><button onClick={uit}><LogOut size={14} /> Uitloggen</button></div>}
      </div>
    </header>
  )
}

/** "Hoelang al open" (9), in hele minuten. */
const minutenOpen = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))

function Lijst() {
  const [tab, setTab] = useState<'spelers' | 'afgerond'>('spelers')
  const [d, setD] = useState<any>(null)
  const [afgerond, setAfgerond] = useState<any>(null)
  const [spelers, setSpelers] = useState<any[] | null>(null)
  const [nieuw, setNieuw] = useState<number | null>(null)
  const nav = useNavigate()
  const laad = useCallback(() => {
    // Overzicht per platenspeler als tegels (9): vrij, ingediend, uitgegeven, met de open aanvraag erbij.
    api('/medewerker/platenspelers').then(setSpelers)
    api('/medewerker/aanvragen?tab=actief').then(setD)
    if (tab === 'afgerond') api('/medewerker/aanvragen?tab=afgerond').then(setAfgerond)
  }, [tab])
  useEffect(() => { laad() }, [laad])
  useEffect(() => { const i = setInterval(laad, 30_000); return () => clearInterval(i) }, [laad]) // "hoelang al open" bijwerken
  useRealtime((e) => {
    if (e?.nieuw) { if (d?.geluid !== false) piep(); setNieuw(e.nieuw); setTimeout(() => setNieuw(null), 4000) }
    laad()
  })

  const actie = async (a: any) => {
    const pad = a.weergave_status === 'nieuw' ? 'ophalen' : a.weergave_status === 'bezig' ? 'uitgeven' : 'vrijgeven'
    await api(`/medewerker/aanvraag/${a.id}/${pad}`, { method: 'POST' }).catch(() => {})
    laad()
  }
  const actieTekst = (s: string) => (s === 'nieuw' ? 'Nu ophalen' : s === 'bezig' ? 'Uitgegeven' : 'Speler vrijgeven')
  const openPerSpeler: Record<number, any> = Object.fromEntries((d?.aanvragen ?? []).map((a: any) => [a.platenspeler, a]))

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'spelers'} className={`tab ${tab === 'spelers' ? 'aan' : ''}`} onClick={() => setTab('spelers')}>
          Platenspelers {d && d.actief > 0 && <span className="teller">{d.actief}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'afgerond'} className={`tab ${tab === 'afgerond' ? 'aan' : ''}`} onClick={() => setTab('afgerond')}>Afgerond</button>
      </div>

      {tab === 'spelers' ? (
        !spelers || !d ? <Laden /> : (
          <div className="spelers-tegels">
            {spelers.map((p) => {
              const a = openPerSpeler[p.nummer]
              const status = !p.actief ? 'Inactief' : !a ? (p.vastgehouden ? 'Bezet' : 'Vrij') : a.status === 'uitgegeven' ? 'Uitgegeven' : 'Ingediend'
              return (
                <div key={p.nummer} className={`card speler-tegel ${a ? 'open' : ''} ${a?.lang_open ? 'lang-open' : ''} ${a && nieuw === a.bestelnummer ? 'nieuw-binnen' : ''} ${!p.actief ? 'inactief' : ''}`}>
                  <div className="tegel-kop">
                    <span className="groot">{p.nummer}</span>
                    <span className={`tegel-status tegel-${status.toLowerCase()}`}>{status}</span>
                  </div>
                  {a ? (
                    <button className="speler-aanvraag" onClick={() => nav(`/medewerker/aanvraag/${a.id}`)} aria-label={`Aanvraag #${a.bestelnummer} openen`}>
                      <span className="bestelnr">#{a.bestelnummer}</span>
                      <span className="muted">{minutenOpen(a.ingediend_op)} min open · {a.aantal} {a.aantal === 1 ? 'titel' : 'titels'}</span>
                      {a.lang_open && <span className="lang-label"><Clock size={13} /> &gt; {d.markering_min} min</span>}
                      <span className="duimen">{a.hoezen.map((h: string, i: number) => <Hoes key={i} src={h} />)}</span>
                    </button>
                  ) : p.vastgehouden ? (
                    <div className="tegel-leeg muted" style={{ fontSize: 15 }}>Een bezoeker gebruikt deze speler{p.bezet_sinds ? ` sinds ${tijd(p.bezet_sinds)}` : ''}; nog geen aanvraag.</div>
                  ) : <div className="tegel-leeg" />}
                  {!a && p.vastgehouden && <button className="btn btn-gray btn-block" style={{ minHeight: 52 }} onClick={async () => { if (confirm(`Platenspeler ${p.nummer} vrijgeven?`)) setSpelers(await api(`/medewerker/platenspeler/${p.nummer}/vrijgeven`, { method: 'POST' })) }}>Speler vrijgeven</button>}
                  {a && <button className="btn btn-gray btn-block" style={{ minHeight: 52 }} onClick={() => actie(a)}>{actieTekst(a.weergave_status)}</button>}
                  <button className={`toggle ${p.actief ? 'aan' : ''}`} aria-pressed={p.actief}
                    onClick={async () => setSpelers(await api(`/medewerker/platenspeler/${p.nummer}`, { body: { actief: !p.actief } }))}>
                    <span className="baan" /> {p.actief ? 'Actief' : 'Inactief'}
                  </button>
                </div>
              )
            })}
          </div>
        )
      ) : !afgerond ? <Laden /> : (
        <div className="tabel-kaart">
          <table className="tabel">
            <thead><tr><th>#</th><th>Tijd</th><th>Platenspeler</th><th>Titels</th><th>Status</th><th style={{ textAlign: 'center' }}></th></tr></thead>
            <tbody>
              {afgerond.aanvragen.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 40 }}>Nog niets afgerond in de afgelopen twee dagen.</td></tr>}
              {afgerond.aanvragen.map((a: any) => (
                <tr key={a.id} className="klikbaar" onClick={() => nav(`/medewerker/aanvraag/${a.id}`)}>
                  <td className="bestelnr">#{a.bestelnummer}</td>
                  <td>{tijd(a.ingediend_op)}</td>
                  <td><span className="nr-bol">{a.platenspeler}</span></td>
                  <td><div className="duimen">{a.hoezen.map((h: string, i: number) => <Hoes key={i} src={h} />)}<span style={{ marginLeft: 6 }}>{a.aantal} {a.aantal === 1 ? 'titel' : 'titels'}</span></div></td>
                  <td><span className={`status status-${a.weergave_status}`}>{STATUS[a.weergave_status]}</span></td>
                  <td style={{ textAlign: 'center' }}><span className="muted tekst-klein">{a.afgesloten_door ? `door ${a.afgesloten_door}` : a.reden ?? ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Detail() {
  const { id } = useParams()
  const [a, setA] = useState<any>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [vraag, setVraag] = useState<null | { soort: 'annuleren' } | { soort: 'item'; item: any }>(null)
  const [reden, setReden] = useState('')
  const nav = useNavigate()
  const laad = useCallback(() => api(`/medewerker/aanvraag/${id}`).then(setA).catch((e: ApiFout) => setFout(e.message)), [id])
  useEffect(() => { laad() }, [laad])
  useRealtime(() => laad())
  const doe = async (pad: string, body?: any) => {
    setFout(null)
    try { setA(await api(`/medewerker/aanvraag/${id}/${pad}`, { method: 'POST', body })) } catch (e) { setFout((e as ApiFout).message) }
  }
  if (!a) return fout ? <div className="melding-blok fout">{fout}</div> : <Laden />
  const open = ['ingediend', 'uitgegeven'].includes(a.status)
  return (
    <>
      <button className="link-terug" onClick={() => nav('/medewerker')}><ArrowLeft size={20} /> Terug</button>
      <div className="detail-kop">
        <h1>Aanvraag #{a.bestelnummer}</h1>
        <span className={`status status-${a.weergave_status}`} style={{ height: 40, minWidth: 110, fontSize: 16 }}>{STATUS[a.weergave_status]}</span>
        <span className="speler-label">Platenspeler<b>{a.platenspeler}</b></span>
        <span className="tijd">{tijd(a.ingediend_op)}{open && <span className="dim tekst-klein"> · {minutenOpen(a.ingediend_op)} min open</span>}</span>
      </div>
      {fout && <div className="melding-blok fout">{fout}</div>}
      <div className="detail-grid">
        <div className="card">
          {a.items.map((i: any, n: number) => (
            <div key={i.id} className={`detail-regel ${i.verwijderd ? 'weg' : ''}`}>
              <span className="volg">{n + 1}</span>
              <Hoes src={i.hoes} />
              <div className="namen"><div>{i.artiesten}</div><div className="muted">{i.titel}</div>{i.verwijderd ? <div className="tekst-klein" style={{ color: 'var(--red)' }}>Uit aanvraag gehaald{i.reden ? `: ${i.reden}` : ''}</div> : null}</div>
              <div className="info"><div>{[i.drager, i.jaar].filter(Boolean).join(' · ')}</div><div>{a.vindcode_label ?? 'Vindcode'}: <b>{i.vindcode ?? '–'}</b></div><div className="dim tekst-klein">Object {i.objectnummer}</div></div>
              {open && !i.verwijderd ? <button className="icon-btn" title="Uit de aanvraag halen" aria-label={`Haal ${i.titel} uit de aanvraag`} onClick={() => { setReden(''); setVraag({ soort: 'item', item: i }) }}><X size={20} /></button> : <span />}
            </div>
          ))}
        </div>
        <div className="card acties-paneel">
          {a.status === 'ingediend' && <button className="btn btn-pink" onClick={() => doe('uitgeven')}>Markeer als uitgegeven</button>}
          {a.status === 'uitgegeven' && <button className="btn btn-pink" onClick={() => doe('vrijgeven')}>Speler vrijgeven</button>}
          {open && <button className="btn btn-gray" onClick={() => { setReden(''); setVraag({ soort: 'annuleren' }) }}>Annuleren</button>}
          {!open && <p className="muted" style={{ textAlign: 'center' }}>Deze aanvraag is {a.status}{a.reden ? `: ${a.reden}` : ''}.</p>}
          {a.status === 'ingediend' && a.weergave_status === 'nieuw' && <p className="muted tekst-klein" style={{ textAlign: 'center', margin: 0 }}><AlertTriangle size={13} /> Titels staan op volgorde van {(a.vindcode_label ?? "vindcode").toLowerCase()}: één ronde door het archief.</p>}
        </div>
      </div>
      {vraag && (
        <div className="modal-achter">
          <div className="card modal" style={{ textAlign: 'left' }}>
            <h2>{vraag.soort === 'annuleren' ? 'Aanvraag annuleren' : 'Titel uit de aanvraag halen'}</h2>
            <p>{vraag.soort === 'annuleren' ? 'De exemplaren worden weer beschikbaar.' : `${vraag.item.titel} wordt weer beschikbaar voor andere bezoekers.`}</p>
            <label className="veld"><span>Reden (optioneel)</span><input value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Bijvoorbeeld: plaat niet te vinden" /></label>
            <div className="knoppen" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setVraag(null)}>Terug</button>
              <button className="btn btn-pink" onClick={() => { const v = vraag; setVraag(null); v.soort === 'annuleren' ? doe('annuleren', { reden }) : doe(`item/${v.item.id}/verwijder`, { reden }) }}>Bevestigen</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
