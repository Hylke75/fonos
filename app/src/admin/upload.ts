// Grote bestanden (back-ups, dumps) gaan rechtstreeks naar de aparte opslag: op Vercel naar Vercel Blob,
// lokaal via de server. Geeft het adres van het bestand terug.
import { api } from '../api'

export async function uploadBestand(f: File, voortgang?: (pct: number) => void): Promise<string> {
  const { blob } = await api<{ blob: boolean }>('/beheer/opslag')
  if (blob) {
    const { upload } = await import('@vercel/blob/client')
    const r = await upload(`uploads/${f.name.replace(/[^\w.-]/g, '_')}`, f, {
      access: 'public', handleUploadUrl: '/api/beheer/blob', multipart: f.size > 20 * 1024 * 1024,
      onUploadProgress: (p) => voortgang?.(Math.round(p.percentage)),
    })
    return r.url
  }
  const fd = new FormData()
  fd.append('bestand', f)
  return (await api<{ adres: string }>('/beheer/upload', { form: fd })).adres
}
