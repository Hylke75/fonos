// "Lezen tijdens het luisteren" (7.3): agenda en verhalen van fonos.nl binnen de app.
// De kioskbrowser staat alleen deze adressen toe.
import { useState } from 'react'
import { useKiosk } from './KioskApp'
import { KioskKopTerug } from './Kop'

export function Lezen() {
  const { config } = useKiosk()
  const paginas = config.instellingen.fonos_paginas
  const [i, setI] = useState(0)
  return (
    <div className="kiosk-scherm" style={{ overflow: 'hidden' }}>
      <KioskKopTerug tekst="Terug naar de collectie" naar="/home" zoekIcoon={false} />
      <div className="tabs-lezen" style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 21 }}>
        {paginas.map((p, n) => <button key={p.url} className={`chip ${n === i ? 'aan' : ''}`} onClick={() => setI(n)}>{p.naam}</button>)}
      </div>
      {paginas[i] && <iframe className="lezen-frame" src={paginas[i].url} title={paginas[i].naam} sandbox="allow-same-origin allow-scripts allow-popups" />}
    </div>
  )
}
