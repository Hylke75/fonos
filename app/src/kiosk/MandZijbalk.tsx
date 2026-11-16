// Zijbalk met je aanvraag ("winkelwagen"): vanuit elk scherm zien wat je gekozen hebt, iets weghalen en doorgaan naar afronden.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, ShoppingBag, X } from 'lucide-react'
import { Hoes } from '../components/Hoes'
import { useKiosk } from './KioskApp'
import { t } from './taal'

export function MandZijbalk() {
  const { mand, verwijder, config, beschikbaar, mandOpen, zetMandOpen, bewaard } = useKiosk()
  const nav = useNavigate()
  const loc = useLocation()
  const max = config.instellingen.max_titels
  // Naar een ander scherm = zijbalk dicht; Escape sluit hem ook.
  useEffect(() => { zetMandOpen(false) }, [loc.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mandOpen) return
    const toets = (e: KeyboardEvent) => { if (e.key === 'Escape') zetMandOpen(false) }
    window.addEventListener('keydown', toets)
    return () => window.removeEventListener('keydown', toets)
  }, [mandOpen, zetMandOpen])
  if (!mandOpen) return null
  return (
    <div className="zijbalk-achter" onClick={() => zetMandOpen(false)}>
      <aside className="zijbalk card" role="dialog" aria-modal="true" aria-labelledby="zijbalk-titel" onClick={(e) => e.stopPropagation()}>
        <div className="zijbalk-kop">
          <h2 id="zijbalk-titel"><ShoppingBag size={22} /> {t('Jouw aanvraag')}</h2>
          <span className="muted">{t('{n} van {max}', { n: mand.length, max })}</span>
          <button className="icon-btn" aria-label={t('Sluiten')} onClick={() => zetMandOpen(false)}><X size={22} /></button>
        </div>
        {mand.length === 0 ? (
          <div className="zijbalk-leeg">
            <p>{t('Je hebt nog niets gekozen.')}</p>
            <p className="muted">{t('Tik bij een plaat op Aanvragen om hem hier te zetten.')}</p>
          </div>
        ) : (
          <ul className="zijbalk-lijst">
            {mand.map((m) => {
              const weg = beschikbaar[m.titel_id]?.beschikbaar === false
              return (
                <li key={m.titel_id} className={weg ? 'weg' : ''}>
                  <button className="zijbalk-titel" onClick={() => nav(`/album/${m.titel_id}`)}>
                    <Hoes src={m.hoes} />
                    <span>
                      <span className="a">{m.artiesten || t('Diverse artiesten')}</span>
                      <span className="t">{m.titel}</span>
                      {weg && <span className="niet">{t('Intussen in gebruik')}</span>}
                    </span>
                  </button>
                  <button className="icon-btn" aria-label={t('Haal {titel} uit je aanvraag', { titel: m.titel })} onClick={() => verwijder(m.titel_id)}><X size={20} /></button>
                </li>
              )
            })}
          </ul>
        )}
        {bewaard.length > 0 && <p className="muted tekst-klein zijbalk-bewaard">{t('{n} bewaard voor later', { n: bewaard.length })}</p>}
        <div className="zijbalk-voet">
          <button className="btn btn-pink btn-l btn-block" disabled={mand.length === 0} onClick={() => nav('/aanvraag')}>
            {t('Aanvraag afronden')} <ArrowRight size={22} />
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => zetMandOpen(false)}>{t('Verder zoeken')}</button>
        </div>
      </aside>
    </div>
  )
}
