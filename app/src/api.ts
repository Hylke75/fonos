// Kleine fetch-helper. Fouten komen terug als ApiFout met de Nederlandse melding van de server.
export class ApiFout extends Error {
  constructor(public status: number, bericht: string, public data: any = {}) { super(bericht) }
}

export async function api<T = any>(pad: string, opts: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(`/api${pad}`, {
      method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: 'same-origin',
      signal: opts.signal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new ApiFout(0, 'Geen verbinding. Controleer het netwerk en probeer het opnieuw.')
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiFout(r.status, data?.fout ?? `Er ging iets mis (${r.status})`, data)
  return data as T
}

export const vandaag = (iso?: string | null) => (iso ? new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z') : null)
export const tijd = (iso?: string | null) => vandaag(iso)?.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) ?? ''
export const datumTijd = (iso?: string | null) => vandaag(iso)?.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? ''
