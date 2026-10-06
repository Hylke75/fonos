// Velden van een titel met twee lagen (6.1, 6.2): Muziekweb-waarde en optionele Fonos-waarde.

export type Track = { pos: number; titel: string; duur?: string | null; componisten?: string[]; uitvoerenden?: string[] }

export type TitelVelden = {
  titel?: string
  artiesten?: string[]
  uitgave?: string // "1973" of "1973-03"
  drager?: string // LP | CD | Overig
  aantal?: number
  label?: string
  ean?: string
  genres?: string[]
  speelduur?: string
  toelichting?: string
  tracklist?: Track[]
  hoes_voor?: string
  hoes_achter?: string
  componisten?: string[] // klassiek (open punt O-3)
  uitvoerenden?: string[] // klassiek (open punt O-3)
}

export const TWEELAAGS: { veld: keyof TitelVelden; label: string; soort: 'tekst' | 'lijst' | 'lang' | 'getal' | 'drager' | 'tracks' | 'hoes' | 'genres' }[] = [
  { veld: 'titel', label: 'Titel', soort: 'tekst' },
  { veld: 'artiesten', label: 'Artiest(en)', soort: 'lijst' },
  { veld: 'uitgave', label: 'Uitgebracht (jaar of jaar-maand)', soort: 'tekst' },
  { veld: 'drager', label: 'Drager', soort: 'drager' },
  { veld: 'aantal', label: 'Aantal dragers', soort: 'getal' },
  { veld: 'label', label: 'Label', soort: 'tekst' },
  { veld: 'ean', label: 'EAN', soort: 'tekst' },
  { veld: 'genres', label: 'Genres', soort: 'genres' },
  { veld: 'speelduur', label: 'Speelduur', soort: 'tekst' },
  { veld: 'toelichting', label: 'Toelichting', soort: 'lang' },
  { veld: 'componisten', label: 'Componist(en)', soort: 'lijst' },
  { veld: 'uitvoerenden', label: 'Uitvoerenden', soort: 'lijst' },
  { veld: 'tracklist', label: 'Tracklist', soort: 'tracks' },
  { veld: 'hoes_voor', label: 'Hoes voorzijde', soort: 'hoes' },
  { veld: 'hoes_achter', label: 'Hoes achterzijde', soort: 'hoes' },
]

export const VELD_LABEL: Record<string, string> = Object.fromEntries(TWEELAAGS.map((v) => [v.veld, v.label]))

export function jaarUit(uitgave?: string | null): number | null {
  const m = /(\d{4})/.exec(uitgave ?? '')
  return m ? Number(m[1]) : null
}

export const REDENEN_AFVOER: Record<string, string> = {
  beschadigd: 'Beschadigd',
  kwijt: 'Kwijt',
  erfgoed: 'Overgebracht naar erfgoedcollectie',
  overig: 'Overig',
}

export const ROLLEN = ['medewerker', 'redacteur', 'beheerder'] as const
export type Rol = (typeof ROLLEN)[number]

/** Normaliseert tekst voor zoeken: kleine letters, zonder accenten, alleen letters en cijfers. */
export function normaliseer(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
