// Realtime updates via Server-Sent Events: medewerkersscherm en beschikbaarheid in de kiosk.
type Client = { send: (event: string, data: unknown) => void; kanaal: 'kiosk' | 'medewerker' }
const clients = new Set<Client>()

export function abonneer(c: Client) {
  clients.add(c)
  return () => clients.delete(c)
}

/** Stuurt een gebeurtenis naar alle verbonden schermen van het kanaal (of alle). */
export function zend(event: string, data: unknown = {}, kanaal?: Client['kanaal']) {
  for (const c of clients) if (!kanaal || c.kanaal === kanaal) {
    try { c.send(event, data) } catch { clients.delete(c) }
  }
}

/** Beschikbaarheid veranderd: kiosk en medewerkers verversen. */
export const beschikbaarheidGewijzigd = (titelIds: number[] = []) => zend('beschikbaarheid', { titelIds })
export const aanvragenGewijzigd = (extra: Record<string, unknown> = {}) => zend('aanvragen', extra, 'medewerker')
