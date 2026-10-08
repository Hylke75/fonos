// Nieuwsbrief-aanmelding op het afrondscherm (7.9, 11). Vrijwillig: het vinkje staat standaard uit;
// pas daarna verschijnen naam (optioneel) en e-mailadres. De app bewaart de gegevens niet.
import { useState } from 'react'
import { X } from 'lucide-react'
import { useKiosk } from './KioskApp'
import { huidigeTaal, t } from './taal'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export type NieuwsbriefKeuze = { aan: boolean; naam: string; email: string }

export function NieuwsbriefBlok({ waarde, wijzig, fout }: { waarde: NieuwsbriefKeuze; wijzig: (w: NieuwsbriefKeuze) => void; fout: string | null }) {
  const { config } = useKiosk()
  const [privacy, setPrivacy] = useState(false)
  return (
    <div className="nieuwsbrief-blok">
      <label className="vinkje">
        <input type="checkbox" checked={waarde.aan} onChange={(e) => wijzig({ ...waarde, aan: e.target.checked })} />
        <span>{t('Ja, ik ontvang graag de nieuwsbrief van Fonos')}</span>
      </label>
      {waarde.aan && (
        <div className="nieuwsbrief-velden">
          <input className="kiosk-veld" value={waarde.naam} onChange={(e) => wijzig({ ...waarde, naam: e.target.value })} placeholder={t('Je naam (optioneel)')} aria-label={t('Je naam (optioneel)')} autoComplete="off" />
          <input className="kiosk-veld" type="email" inputMode="email" value={waarde.email} onChange={(e) => wijzig({ ...waarde, email: e.target.value })} placeholder={t('Je e-mailadres')} aria-label={t('Je e-mailadres')} autoComplete="off" aria-invalid={!!fout} />
          {fout && <div className="fout-tekst" role="alert">{fout}</div>}
          <div className="privacy">{(huidigeTaal() === 'en' && config.instellingen.privacy_tekst_en) || config.instellingen.privacy_tekst} {config.instellingen.privacy_url && <button type="button" onClick={() => setPrivacy(true)}>{t('Privacyverklaring')}</button>}</div>
        </div>
      )}
      {privacy && (
        <div className="modal-achter">
          <div className="card" style={{ width: 'min(1000px, 100%)', height: '80vh', position: 'relative', overflow: 'hidden' }}>
            <button className="icon-btn" style={{ position: 'absolute', right: 12, top: 12, zIndex: 2 }} onClick={() => setPrivacy(false)} aria-label={t('Sluiten')}><X size={22} /></button>
            <iframe src={config.instellingen.privacy_url} title={t('Privacyverklaring')} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} sandbox="allow-same-origin" />
          </div>
        </div>
      )}
    </div>
  )
}
