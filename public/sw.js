// TradeSignal Pro — Service Worker v1.0
const CACHE_NAME = 'tradesignal-v1';
const ASSETS = ['/', '/index.html'];

// ── INSTALL: cache assets ──────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: serve from cache, fallback to network ──────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ── PUSH: background notification ─────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'TradeSignal', body: 'Naya signal aaya!', type: 'new' };
  try { data = e.data.json(); } catch(_) {}

  const icon  = '/icon-192.png';
  const badge = '/icon-192.png';

  let title = 'TradeSignal Pro';
  let body  = data.body || 'Naya signal aaya!';
  let tag   = data.type || 'signal';
  let vibrate = [200, 100, 200];

  if (data.type === 'tp') {
    title   = '🎯 TP HIT — ' + (data.pair || '');
    body    = (data.pair || '') + ' · +' + (data.pnl || '') + ' USD · Take Profit reached!';
    vibrate = [100, 50, 100, 50, 300]; // beep beep beep
  } else if (data.type === 'sl') {
    title   = '❌ SL HIT — ' + (data.pair || '');
    body    = (data.pair || '') + ' · ' + (data.pnl || '') + ' USD · Stop Loss triggered';
    vibrate = [300, 100, 300];
  } else if (data.type === 'new') {
    title   = '📡 New Signal — ' + (data.pair || '');
    body    = (data.dir ? data.dir.toUpperCase() : '') + ' ' + (data.pair || '') + ' · Entry: ' + (data.entry || '');
    vibrate = [100, 50, 100];
  }

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      vibrate,
      requireInteraction: data.type === 'tp' || data.type === 'sl', // TP/SL stay on screen
      data: { url: '/' }
    })
  );
});

// ── NOTIFICATION CLICK: open app ──────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(e.notification.data?.url || '/');
    })
  );
});

// ── MESSAGE: main app se signal receive karo ──────────────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const d = e.data;
    let title = 'TradeSignal Pro';
    let body  = '';
    let vibrate = [200, 100, 200];

    if (d.alertType === 'tp') {
      title   = '🎯 TP HIT — ' + (d.pair || '');
      body    = '+' + (d.pnl || '') + ' USD · Take Profit reached!';
      vibrate = [100, 50, 100, 50, 100, 50, 300];
    } else if (d.alertType === 'sl') {
      title   = '❌ SL HIT — ' + (d.pair || '');
      body    = (d.pnl || '') + ' USD · Stop Loss triggered';
      vibrate = [300, 100, 300];
    } else {
      title   = '📡 New Signal — ' + (d.pair || '');
      body    = (d.dir ? d.dir.toUpperCase() : '') + ' · Entry: ' + (d.entry || '');
      vibrate = [100, 50, 100];
    }

    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.alertType,
      vibrate,
      requireInteraction: d.alertType === 'tp' || d.alertType === 'sl',
      data: { url: '/' }
    });
  }
});
