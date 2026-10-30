// app shell em cache; rede primeiro, cache só como reserva offline. /api e /ws nunca passam pelo cache.
const CACHE = 'gubots-v5'
const SHELL = ['/', '/manifest.webmanifest?v=2', '/icon-chefe-192.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})
// Ao assumir no lugar de outro app (ex.: o Jarvis antigo deste domínio) ou de uma versão velha: apaga os caches
// alheios e recarrega as abas abertas, senão elas continuam mostrando o app antigo guardado.
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k !== CACHE)
    await Promise.all(old.map((k) => caches.delete(k)))
    await self.clients.claim()
    // havia cache de outra versão/app → recarrega as abas (primeira visita não tem cache e não recarrega)
    if (old.length) for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {})
  })())
})
// ---------- notificações push (como mensagem de WhatsApp): foto do bot, ícone na barra, agrupadas por conversa ----------
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'Gubots', body: e.data?.text() ?? '' } }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // app aberto e na frente: a própria página toca o aviso, sem notificação duplicada
    if (d.tag !== 'teste' && wins.some((w) => w.focused && w.visibilityState === 'visible')) return
    const tag = d.tag || 'gubots'
    const prev = (await self.registration.getNotifications({ tag }))[0]
    const n = (prev?.data?.n ?? 0) + 1
    await self.registration.showNotification(n > 1 ? `${d.title} · ${n} mensagens` : d.title || 'Gubots', {
      body: d.body || '', tag, renotify: true, icon: d.icon || '/icon-chefe-192.png', badge: '/badge.png',
      vibrate: [90, 50, 90], timestamp: d.ts || Date.now(), data: { convId: d.convId, n },
    })
  })())
})
// tocar na notificação abre (ou traz para a frente) o app já na conversa
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const convId = e.notification.data?.convId
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const w = wins.find((c) => new URL(c.url).origin === location.origin)
    if (w) { await w.focus().catch(() => {}); if (convId) w.postMessage({ t: 'open-conv', convId }); return }
    await self.clients.openWindow(convId ? `/?conv=${encodeURIComponent(convId)}` : '/')
  })())
})

self.addEventListener('fetch', (e) => {
  const r = e.request
  const u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/ws') || u.pathname.startsWith('/api')) return
  // páginas sempre da rede, ignorando o cache HTTP (que pode ter o app antigo guardado)
  e.respondWith(
    (r.mode === 'navigate' ? fetch(r.url, { cache: 'no-store', credentials: 'include' }) : fetch(r)).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)) }
      return res
    }).catch(() => caches.match(r).then((m) => m || caches.match('/')))
  )
})
