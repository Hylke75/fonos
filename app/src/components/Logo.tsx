// Fonos-logo (aangeleverd bestand: FONOS - Three layered - Heavy - Wit).
export function Logo({ className = 'logo', titel = 'Fonos' }: { className?: string; titel?: string }) {
  return <img className={className} src="/fonos-logo.svg" alt={titel} draggable={false} />
}
