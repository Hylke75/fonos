import { useEffect, useState } from 'react'
import { HoesPlaceholder } from './Iconen'

/** Kleinere versie van een Muziekweb-hoes voor rasters en lijsten (sneller laden op de tablets). */
const klein = (src: string) => src.replace('/COVER/MEDIUM/', '/COVER/SMALL/')

/** Albumhoes met lazy loading en een placeholder als de hoes ontbreekt of niet laadt.
 *  Standaard het kleine formaat; bestaat dat (nog) niet, dan het gewone formaat. groot = altijd het gewone formaat. */
export function Hoes({ src, alt = '', className = '', style, groot = false }: { src?: string | null; alt?: string; className?: string; style?: React.CSSProperties; groot?: boolean }) {
  const [poging, setPoging] = useState(0)
  useEffect(() => setPoging(0), [src])
  const bron = !src ? null : !groot && poging === 0 && src.includes('/COVER/MEDIUM/') ? klein(src) : poging <= 1 ? src : null
  return (
    <div className={`cover ${className}`} style={style}>
      {bron ? <img key={bron} src={bron} alt={alt} loading="lazy" decoding="async" onError={() => setPoging((p) => (bron !== src ? 1 : 2))} /> : <HoesPlaceholder />}
    </div>
  )
}
