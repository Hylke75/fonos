// Bouwt een back-upzip in een aparte thread, zodat kiosk en medewerkersscherm blijven reageren.
import { parentPort, workerData } from 'node:worker_threads'
import { maakZipDirect } from './backup.ts'

const { opts, doel } = workerData as { opts: { excel: boolean; hoezen: boolean }; doel: string }
maakZipDirect(opts, doel)
  .then((omvang) => parentPort!.postMessage({ omvang }))
  .catch((e) => parentPort!.postMessage({ fout: String(e?.message ?? e) }))
