// Fonos-logo: verloop van cyaan naar roze in de F, de rest roze.
export function Logo({ className = 'logo', titel = 'Fonos' }: { className?: string; titel?: string }) {
  return (
    <svg className={className} viewBox="0 0 168 48" role="img" aria-label={titel}>
      <defs>
        <linearGradient id="fonos-f" x1="0" x2="1" y1="0" y2="0.2">
          <stop offset="0" stopColor="#14d8f8" />
          <stop offset="0.13" stopColor="#3aa6f2" />
          <stop offset="0.22" stopColor="#ff14b4" />
          <stop offset="1" stopColor="#ff14b4" />
        </linearGradient>
      </defs>
      <text x="0" y="41" fontFamily="Rubik, Inter, sans-serif" fontWeight="900" fontSize="49" letterSpacing="-1" fill="url(#fonos-f)">FONOS</text>
    </svg>
  )
}
