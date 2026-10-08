// Eigen iconen: lp, cd, platenspeler (laadindicator) en hoes-placeholder.
import type { SVGProps } from 'react'
import { t } from '../kiosk/taal'

export function LpIcoon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity=".15" />
      <circle cx="12" cy="12" r="6.5" strokeOpacity=".55" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  )
}

export function CdIcoon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 4.6a7.4 7.4 0 0 1 7.4 7.4" strokeOpacity=".6" />
    </svg>
  )
}

export function DragerIcoon({ drager, ...p }: { drager?: string | null } & SVGProps<SVGSVGElement>) {
  return drager === 'LP' ? <LpIcoon {...p} /> : <CdIcoon {...p} />
}

/** Beschikbaarheid altijd met vorm én kleur: drager-icoon met vinkje (groen) of kruisje (rood), plus tekst. */
export function Beschikbaarheid({ drager, beschikbaar, tekst = true }: { drager?: string | null; beschikbaar: boolean; tekst?: boolean }) {
  return (
    <span className={`beschikbaar ${beschikbaar ? 'ja' : 'nee'}`} title={beschikbaar ? t('Beschikbaar') : t('In gebruik')}>
      <span style={{ position: 'relative', display: 'inline-grid' }}>
        <DragerIcoon drager={drager} />
        <svg viewBox="0 0 12 12" style={{ position: 'absolute', right: -4, bottom: -3, width: 12, height: 12 }}>
          <circle cx="6" cy="6" r="6" fill="#040a1e" />
          {beschikbaar
            ? <path d="M3 6.2 5 8l4-4.2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            : <path d="M3.6 3.6l4.8 4.8M8.4 3.6 3.6 8.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
        </svg>
      </span>
      {tekst && <span>{drager ?? ''} {beschikbaar ? t('beschikbaar') : t('in gebruik')}</span>}
    </span>
  )
}

export function Platenspeler() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="12" width="92" height="76" rx="10" fill="#111a31" stroke="#243050" strokeWidth="2" />
      <g className="plaat">
        <circle cx="44" cy="50" r="30" fill="#05070f" />
        <circle cx="44" cy="50" r="24" fill="none" stroke="#1d2640" strokeWidth="1.5" />
        <circle cx="44" cy="50" r="18" fill="none" stroke="#1d2640" strokeWidth="1.5" />
        <circle cx="44" cy="50" r="9" fill="#ff14b4" />
        <circle cx="47" cy="47" r="2" fill="#ffd6f0" />
        <circle cx="44" cy="50" r="1.6" fill="#05070f" />
      </g>
      <circle cx="84" cy="24" r="4" fill="#243050" />
      <path d="M84 24 L82 62 L68 70" fill="none" stroke="#c9d0de" strokeWidth="3" strokeLinecap="round" />
      <rect x="62" y="67" width="10" height="7" rx="2" fill="#1fe0fb" transform="rotate(-28 67 70)" />
    </svg>
  )
}

export function Laden({ tekst }: { tekst?: string }) {
  tekst ??= t('Even geduld…')
  return <div className="laden" role="status"><Platenspeler /><span>{tekst}</span></div>
}

export function HoesPlaceholder() {
  return (
    <div className="placeholder" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="30" fill="#060a16" />
        <circle cx="32" cy="32" r="22" fill="none" stroke="#1c2540" />
        <circle cx="32" cy="32" r="15" fill="none" stroke="#1c2540" />
        <circle cx="32" cy="32" r="8" fill="#ff14b4" fillOpacity=".8" />
        <circle cx="32" cy="32" r="1.6" fill="#060a16" />
      </svg>
    </div>
  )
}

export function SpeelIcoon() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor" /></svg>
}
