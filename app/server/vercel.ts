// Ingang voor de Vercel-functie (Node.js): alle /api-verzoeken.
import { getRequestListener } from '@hono/node-server'
import { app } from './app.ts'

process.env.TZ ??= 'Europe/Amsterdam'
export default getRequestListener(app.fetch)
