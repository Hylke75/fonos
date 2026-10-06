// Rustscherm (7.2): na inactiviteit. Aanraken opent de homepagina.
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Logo } from '../components/Logo'
import { useKiosk } from './KioskApp'

export function Rust() {
  const nav = useNavigate()
  const { config } = useKiosk()
  const start = () => nav('/speler')
  const bumper = config.instellingen.bumper_video_url
  if (bumper) {
    // De bumper (B&G-logo dat verandert in het Fonos-logo) in een lus.
    return (
      <div className="hero" onPointerDown={start} role="button" aria-label="Tik om te beginnen">
        <video src={bumper} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  }
  return (
    <div className="hero" onPointerDown={start} role="button" aria-label="Tik om te beginnen">
      <div className="vorm vorm-a" />
      <div className="vorm vorm-b" />
      <div className="vorm vorm-c" />
      <div className="hero-inhoud">
        <div className="top"><Logo /><span className="badge-nl" style={{ marginRight: '0' }}>NL</span></div>
        <h1>De<br />Fonotheek</h1>
        <p className="lead">Ontdek, luister en laat je verrassen door onze collectie lp's en cd's.</p>
        <button className="btn btn-pink btn-l" onClick={start}>Begin met zoeken <ArrowRight size={24} /></button>
      </div>
    </div>
  )
}
