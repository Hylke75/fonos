// Service worker van de Fonotheek: toont pushmeldingen voor medewerkers (verbetering 9).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { titel: 'Fonotheek', tekst: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.titel || 'Fonotheek', {
    body: d.tekst || '', tag: d.tag, renotify: !!d.tag, icon: '/favicon.svg', badge: '/favicon.svg',
    data: { url: d.url || '/medewerker' }, requireInteraction: false,
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/medewerker'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ramen) => {
    const open = ramen.find((r) => new URL(r.url).pathname.startsWith('/medewerker'))
    return open ? open.focus() : self.clients.openWindow(url)
  }))
})
