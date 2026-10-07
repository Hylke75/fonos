// Collectie (10.1): zoeken, filters, tellers, lijst; nieuwe titel toevoegen (10.4).
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react'
import { api, ApiFout, datumTijd } from '../api'
import { Hoes } from '../components/Hoes'
import { Laden } from '../components/Iconen'
import { Melding, Modal, SelectBlok, ZoekVeld } from './ui'

export function Collectie() {
  const [p, setP] = useSearchParams()
  const [d, setD] = useState<any>(null)
  const [tellers, setTellers] = useState<any>(null)
  const [genres, setGenres] = useState<{ naam: string; n: number }[]>([])
  const [gekozen, setGekozen] = useState<Set<number>>(new Set())
  const [menu, setMenu] = useState<number | null>(null)
  const [nieuw, setNieuw] = useState(false)
  const [meer, setMeer] = useState(['soort', 'zichtbaar', 'aangepast', 'collectie'].some((k) => p.get(k)))
  const nav = useNavigate()
  const q = p.toString()
  const zet = (k: string, v: string) => { const n = new URLSearchParams(p); v ? n.set(k, v) : n.delete(k); n.delete('pagina'); setP(n, { replace: true }) }
  const laad = () => api(`/beheer/titels?${q}`).then(setD)
  useEffect(() => { setD(null); laad(); setGekozen(new Set()) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api('/beheer/tellers').then(setTellers); api('/beheer/genres').then(setGenres) }, [])
  const pagina = Number(p.get('pagina') ?? 1)

  const bulk = async (body: any) => {
    await api('/beheer/titels/bulk', { body: { ids: [...gekozen], ...body } })
    setGekozen(new Set())
    laad()
  }

  return (
    <>
      <h1>Collectie</h1>
      {tellers && (
        <div className="tellers">
          <div className="teller-blok"><div className="w">{tellers.titels.toLocaleString('nl-NL')}</div><div className="l">titels</div></div>
          <div className="teller-blok"><div className="w">{tellers.exemplaren.toLocaleString('nl-NL')}</div><div className="l">exemplaren in collectie</div></div>
          <button className={`teller-blok ${tellers.datakwaliteit ? 'let-op' : ''}`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => nav('/beheer/importeren?tab=datakwaliteit')}>
            <div className="w">{tellers.datakwaliteit.toLocaleString('nl-NL')}</div><div className="l">open datakwaliteitspunten</div>
          </button>
          <div className="teller-blok"><div className="w" style={{ fontSize: 15, paddingTop: 4 }}>{tellers.laatste_import ? datumTijd(tellers.laatste_import) : 'nog niet'}</div><div className="l">laatste Muziekweb-import</div></div>
          <div className="teller-blok"><div className="w" style={{ fontSize: 15, paddingTop: 4 }}>{tellers.laatste_backup ? datumTijd(tellers.laatste_backup) : 'nog niet'}</div><div className="l">laatste back-up</div></div>
        </div>
      )}
      <div className="werkbalk">
        <ZoekVeld waarde={p.get('q') ?? ''} onChange={(v) => zet('q', v)} placeholder="Zoek op titel, artiest, titelnummer…" />
        <SelectBlok label="Drager" waarde={p.get('drager') ?? ''} onChange={(v) => zet('drager', v)} opties={[{ waarde: '', label: 'Alle dragers' }, { waarde: 'LP', label: 'LP' }, { waarde: 'CD', label: 'CD' }, { waarde: 'Overig', label: 'Overig' }]} />
        <SelectBlok label="Genre" waarde={p.get('genre') ?? ''} onChange={(v) => zet('genre', v)} opties={[{ waarde: '', label: 'Alle genres' }, ...genres.map((g) => ({ waarde: g.naam, label: `${g.naam} (${g.n})` }))]} />
        <button className="btn btn-outline icoon-filter" onClick={() => setMeer(!meer)} aria-expanded={meer} aria-label="Meer filters" title="Meer filters"><SlidersHorizontal size={18} /></button>
        <button className="btn btn-cyan" onClick={() => setNieuw(true)}><Plus size={20} /> Nieuwe titel</button>
      </div>
      {meer && (
        <div className="werkbalk">
          <SelectBlok label="Soort" waarde={p.get('soort') ?? ''} onChange={(v) => zet('soort', v)} opties={[{ waarde: '', label: 'Klassiek en populair' }, { waarde: 'populair', label: 'Populair' }, { waarde: 'klassiek', label: 'Klassiek' }]} />
          <SelectBlok label="Zichtbaar" waarde={p.get('zichtbaar') ?? ''} onChange={(v) => zet('zichtbaar', v)} opties={[{ waarde: '', label: 'Zichtbaar: alle' }, { waarde: 'ja', label: 'Zichtbaar in app' }, { waarde: 'nee', label: 'Verborgen' }]} />
          <SelectBlok label="Aangepast" waarde={p.get('aangepast') ?? ''} onChange={(v) => zet('aangepast', v)} opties={[{ waarde: '', label: 'Aangepast: alle' }, { waarde: 'ja', label: 'Aangepast door Fonos' }, { waarde: 'nee', label: 'Niet aangepast' }]} />
          <SelectBlok label="Collectie" waarde={p.get('collectie') ?? ''} onChange={(v) => zet('collectie', v)} opties={[{ waarde: '', label: 'In en uit collectie' }, { waarde: 'in', label: 'In collectie' }, { waarde: 'uit', label: 'Uit collectie' }]} />
        </div>
      )}

      <div className="tabel-kaart" style={{ background: '#030f1b' }}>
        {gekozen.size > 0 && (
          <div className="bulkbalk">
            <span>{gekozen.size} geselecteerd</span>
            <button className="btn btn-ghost btn-s" onClick={() => bulk({ zichtbaar: true })}>Tonen in app</button>
            <button className="btn btn-ghost btn-s" onClick={() => bulk({ zichtbaar: false })}>Verbergen</button>
            <button className="btn btn-ghost btn-s" onClick={() => bulk({ uitgelicht: true })}>Uitlichten</button>
            <button className="btn btn-ghost btn-s" onClick={() => bulk({ uitgelicht: false })}>Niet meer uitlichten</button>
          </div>
        )}
        {!d ? <Laden /> : (
          <table className="btabel">
            <thead><tr>
              <th style={{ width: 52 }}><input type="checkbox" aria-label="Alles selecteren" checked={d.titels.length > 0 && d.titels.every((t: any) => gekozen.has(t.id))} onChange={(e) => setGekozen(e.target.checked ? new Set(d.titels.map((t: any) => t.id)) : new Set())} /></th>
              <th>Titel</th><th>Artiest</th><th>Jaar</th><th>Drager</th><th>Exemplaren</th><th>Status</th><th style={{ width: 56 }} />
            </tr></thead>
            <tbody>
              {d.titels.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 40 }}>Geen titels gevonden.</td></tr>}
              {d.titels.map((t: any) => (
                <tr key={t.id} className="klikbaar" onClick={() => nav(`/beheer/titel/${t.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Selecteer ${t.titel}`} checked={gekozen.has(t.id)} onChange={(e) => { const n = new Set(gekozen); e.target.checked ? n.add(t.id) : n.delete(t.id); setGekozen(n) }} /></td>
                  <td><div className="titel-cel"><Hoes src={t.hoes} /><span>{t.titel}{t.heeft_fonos ? <span className="mini-label fonos">Fonos</span> : null}{t.conflict ? <span className="mini-label conflict">conflict</span> : null}</span></div></td>
                  <td>{t.artiesten}</td>
                  <td>{t.jaar ?? ''}</td>
                  <td>{t.drager ?? ''}</td>
                  <td style={{ paddingLeft: 24 }}>{t.exemplaren}</td>
                  <td>{t.exemplaren === 0 ? <span className="status status-verborgen">Uit collectie</span> : t.zichtbaar ? <span className="status status-actief">Actief</span> : <span className="status status-verborgen">Verborgen</span>}</td>
                  <td style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                    <button className="menu-knop" aria-label="Meer acties" onClick={() => setMenu(menu === t.id ? null : t.id)}><MoreHorizontal size={22} /></button>
                    {menu === t.id && (
                      <div className="popmenu" onMouseLeave={() => setMenu(null)}>
                        <button onClick={() => nav(`/beheer/titel/${t.id}`)}>Bewerken</button>
                        <button onClick={() => nav(`/beheer/titel/${t.id}?tab=voorbeeld`)}>Voorbeeld in de app</button>
                        <button onClick={async () => { await api(`/beheer/titel/${t.id}`, { method: 'PATCH', body: { eigen: { zichtbaar: !t.zichtbaar } } }); setMenu(null); laad() }}>{t.zichtbaar ? 'Verbergen in app' : 'Tonen in app'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d && d.totaal > d.per && (
          <div className="paginering">
            {((pagina - 1) * d.per + 1).toLocaleString('nl-NL')}–{Math.min(pagina * d.per, d.totaal).toLocaleString('nl-NL')} van {d.totaal.toLocaleString('nl-NL')}
            <button className="btn btn-ghost btn-s" disabled={pagina <= 1} onClick={() => zet('pagina', String(pagina - 1))}>Vorige</button>
            <button className="btn btn-ghost btn-s" disabled={pagina * d.per >= d.totaal} onClick={() => { const n = new URLSearchParams(p); n.set('pagina', String(pagina + 1)); setP(n) }}>Volgende</button>
          </div>
        )}
      </div>
      {nieuw && <NieuweTitel onSluit={() => setNieuw(false)} />}
    </>
  )
}

function NieuweTitel({ onSluit }: { onSluit: () => void }) {
  const [tab, setTab] = useState<'nummer' | 'handmatig'>('nummer')
  const [tn, setTn] = useState('')
  const [voorbeeld, setVoorbeeld] = useState<any>(null)
  const [obj, setObj] = useState('')
  const [vind, setVind] = useState('')
  const [h, setH] = useState({ titel: '', artiesten: '', uitgave: '', drager: 'LP', label: '' })
  const [m, setM] = useState<any>(null)
  const nav = useNavigate()
  const zoek = async () => {
    setM(null); setVoorbeeld(null)
    try { setVoorbeeld(await api(`/beheer/dump/${encodeURIComponent(tn.trim())}`)) } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  const voegToe = async () => {
    setM(null)
    try {
      const body = tab === 'nummer'
        ? { titelnummer: voorbeeld.titelnummer, objectnummer: obj, vindcode: vind }
        : { objectnummer: obj, vindcode: vind, handmatig: { ...h, artiesten: h.artiesten.split(',').map((x) => x.trim()).filter(Boolean) } }
      const r = await api('/beheer/titels', { body })
      nav(`/beheer/titel/${r.id}`)
    } catch (e) { setM({ soort: 'fout', tekst: (e as ApiFout).message }) }
  }
  return (
    <Modal titel="Nieuwe titel of exemplaar" onSluit={onSluit}>
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'nummer' ? 'aan' : ''}`} onClick={() => setTab('nummer')}>Op titelnummer</button>
        <button className={`tab ${tab === 'handmatig' ? 'aan' : ''}`} onClick={() => setTab('handmatig')}>Handmatig, zonder Muziekweb</button>
      </div>
      {tab === 'nummer' ? (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <label className="veld" style={{ flex: 1, marginBottom: 0 }}><span>Titelnummer (Muziekweb)</span><input value={tn} onChange={(e) => setTn(e.target.value.toUpperCase())} placeholder="bijvoorbeeld JK278045" onKeyDown={(e) => e.key === 'Enter' && zoek()} /></label>
            <button className="btn btn-ghost" onClick={zoek} disabled={!tn.trim()}>Zoeken</button>
          </div>
          {voorbeeld && (
            <div className="paneel card" style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center' }}>
              <Hoes src={voorbeeld.velden.hoes_voor} style={{ width: 84 }} />
              <div>
                <div style={{ fontWeight: 700 }}>{voorbeeld.velden.titel}</div>
                <div className="muted">{(voorbeeld.velden.artiesten ?? []).join(', ')}</div>
                <div className="dim tekst-klein">{[voorbeeld.velden.drager, voorbeeld.velden.uitgave, voorbeeld.velden.label].filter(Boolean).join(' · ')}</div>
                {voorbeeld.bestaande_titel && <div className="tekst-klein" style={{ color: 'var(--cyan)', marginTop: 6 }}>Deze titel staat al in de collectie: er wordt alleen een exemplaar toegevoegd.</div>}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="veld"><span>Titel *</span><input value={h.titel} onChange={(e) => setH({ ...h, titel: e.target.value })} /></label>
          <label className="veld"><span>Artiest(en), gescheiden door komma's</span><input value={h.artiesten} onChange={(e) => setH({ ...h, artiesten: e.target.value })} /></label>
          <div className="drie-kol">
            <label className="veld"><span>Uitgebracht (jaar)</span><input value={h.uitgave} onChange={(e) => setH({ ...h, uitgave: e.target.value })} /></label>
            <label className="veld"><span>Drager</span><select value={h.drager} onChange={(e) => setH({ ...h, drager: e.target.value })}><option>LP</option><option>CD</option><option>Overig</option></select></label>
            <label className="veld"><span>Label</span><input value={h.label} onChange={(e) => setH({ ...h, label: e.target.value })} /></label>
          </div>
          <p className="muted tekst-klein">De overige velden (tracklist, hoezen, genres) vul je daarna in het bewerkscherm in. Later kun je de titel aan een titelnummer koppelen.</p>
        </>
      )}
      <div className="drie-kol" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <label className="veld"><span>Objectnummer</span><input value={obj} onChange={(e) => setObj(e.target.value.trim())} inputMode="numeric" placeholder="9 cijfers" /></label>
        <label className="veld"><span>Vindcode</span><input value={vind} onChange={(e) => setVind(e.target.value)} /></label>
      </div>
      <Melding m={m} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onSluit}>Annuleren</button>
        <button className="btn btn-cyan" disabled={tab === 'nummer' ? !voorbeeld : !h.titel.trim()} onClick={voegToe}><Plus size={18} /> Toevoegen</button>
      </div>
    </Modal>
  )
}
