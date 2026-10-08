// Artiestpagina (7.7): alle beschikbare titels van deze artiest in de collectie.
// Artiestinformatie volgt pas als de Muziekweb-dump die bevat (open punt O-2).
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { Laden } from '../components/Iconen'
import { useKiosk } from './KioskApp'
import { KioskKopTerug } from './Kop'
import { AlbumKaart, type Kaart } from './Kaarten'
import { t } from './taal'

export function Artiest() {
  const { naam = '' } = useParams()
  const { versie } = useKiosk()
  const [d, setD] = useState<{ naam: string; titels: Kaart[] } | null>(null)
  useEffect(() => { api(`/kiosk/artiest?naam=${encodeURIComponent(naam)}`).then(setD).catch(() => setD({ naam, titels: [] })) }, [naam, versie])
  return (
    <div className="kiosk-scherm">
      <KioskKopTerug tekst="Terug" />
      <main className="kiosk-inhoud">
        <div className="resultaten-kop">
          <h1 style={{ fontSize: 38 }}>{naam}</h1>
          {d && <span className="muted">{t(d.titels.length === 1 ? '{n} titel in de collectie' : '{n} titels in de collectie', { n: d.titels.length })}</span>}
        </div>
        {!d && <Laden />}
        {d && d.titels.length === 0 && <div className="leeg"><h2>{t('Geen titels gevonden')}</h2></div>}
        {d && <div className="raster">{d.titels.map((k) => <AlbumKaart key={k.id} k={k} voet />)}</div>}
      </main>
    </div>
  )
}
