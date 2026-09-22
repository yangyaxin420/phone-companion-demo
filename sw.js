const CACHE = 'phone-demo-v2';
const SW_VERSION = 2;

self.addEventListener('install', e => {
  console.log('[SW] Install v' + SW_VERSION);
  // 删除所有旧缓存
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => {
      if (k !== CACHE) return caches.delete(k);
    })))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activate v' + SW_VERSION);
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  // 只处理同源 GET（页面静态资源），网络优先、缓存兜底；
  // API(POST/跨域：deepseek/高德/天气)一律放行不缓存
  const reqUrl = new URL(e.request.url);
  if (e.request.method !== 'GET' || reqUrl.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r && r.ok) {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener('message', e => {
  if (e.data.type === 'schedule-notification') {
    const { title, body, time } = e.data;
    const delay = Math.max(0, time - Date.now());
    setTimeout(() => {
      self.registration.showNotification(title, {
        body, icon: 'icon-192.png', badge: 'icon-192.png',
        vibrate: [200, 100, 200], requireInteraction: true
      });
    }, delay);
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(self.registration.scope));
});
