import { useState } from 'react'
import { HoesPlaceholder } from './Iconen'

/** Albumhoes met lazy loading en een placeholder als de hoes ontbreekt of niet laadt. */
export function Hoes({ src, alt = '', className = '', style }: { src?: string | null; alt?: string; className?: string; style?: React.CSSProperties }) {
  const [fout, setFout] = useState(false)
  return (
    <div className={`cover ${className}`} style={style}>
      {src && !fout ? <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFout(true)} /> : <HoesPlaceholder />}
    </div>
  )
}
