// Kleine bouwstenen voor de beheeromgeving.
import { ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export function SelectBlok({ waarde, onChange, opties, label }: { waarde: string; onChange: (v: string) => void; opties: { waarde: string; label: string }[]; label: string }) {
  return (
    <label className="select-blok">
      <span className="visually-hidden">{label}</span>
      <select value={waarde} onChange={(e) => onChange(e.target.value)}>{opties.map((o) => <option key={o.waarde} value={o.waarde}>{o.label}</option>)}</select>
      <ChevronDown size={18} />
    </label>
  )
}

export function ZoekVeld({ waarde, onChange, placeholder }: { waarde: string; onChange: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(waarde)
  useEffect(() => setV(waarde), [waarde])
  useEffect(() => { const t = setTimeout(() => v !== waarde && onChange(v), 300); return () => clearTimeout(t) }, [v]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="zoek-veld">
      <Search size={20} />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  )
}

export function Modal({ titel, onSluit, children, breed = false }: { titel: string; onSluit: () => void; children: React.ReactNode; breed?: boolean }) {
  return (
    <div className="modal-achter" onPointerDown={(e) => e.target === e.currentTarget && onSluit()}>
      <div className="card" role="dialog" aria-label={titel} style={{ width: breed ? 'min(1100px, 100%)' : 'min(620px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 28, textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>{titel}</h2>
          <button className="menu-knop" style={{ marginLeft: 'auto' }} onClick={onSluit} aria-label="Sluiten"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toggle({ aan, onChange, label }: { aan: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className={`toggle ${aan ? 'aan' : ''}`} aria-pressed={aan} onClick={() => onChange(!aan)}><span className="baan" /> {label}</button>
}

export function Melding({ m }: { m: { soort: 'ok' | 'fout' | 'info'; tekst: string } | null }) {
  if (!m) return null
  return <div className={`melding-blok ${m.soort === 'info' ? '' : m.soort}`} role={m.soort === 'fout' ? 'alert' : 'status'}>{m.tekst}</div>
}

export const tekstWaarde = (v: unknown): string => {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? `${(x as any).pos ?? ''}. ${(x as any).titel ?? ''} ${(x as any).duur ?? ''}` : String(x))).join(typeof v[0] === 'object' ? '\n' : ', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
