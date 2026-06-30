// GhostChat Service Worker v2.0 â€” stale-while-revalidate + push
const CACHE = 'gc-v1.81';

// â”€â”€ Install: pre-cache shell â”€â”€
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return c.addAll(['./index.html','./manifest.json','./icon192.png','./icon512.png','./icon-maskable.png','./apple-touch-icon.png']);
    }).catch(function(){})
  );
  self.skipWaiting();
});

// â”€â”€ Activate: purge stale caches â”€â”€
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
    })
  );
  e.waitUntil(self.clients.claim());
});

// â”€â”€ Fetch: stale-while-revalidate for app assets, passthrough for API â”€â”€
self.addEventListener('fetch', function(e){
  var url = e.request.url;
  if(e.request.method !== 'GET') return;
  // Supabase API, metered TURN, push APIs â†’ network only (no cache)
  if(url.indexOf('supabase.co') >= 0 || url.indexOf('metered.ca') >= 0 ||
     url.indexOf('onesignal.com') >= 0 || url.indexOf('fcm.googleapis.com') >= 0) return;

  e.respondWith(
    caches.open(CACHE).then(function(cache){
      return cache.match(e.request).then(function(cached){
        // Revalidate in background
        var fresh = fetch(e.request).then(function(resp){
          if(resp && resp.status === 200 && resp.type !== 'opaque'){
            cache.put(e.request, resp.clone());
          }
          return resp;
        }).catch(function(){ return cached || new Response('Offline', {status: 503}); });
        // Serve cache immediately if available, otherwise wait for network
        return cached || fresh;
      });
    })
  );
});

// â”€â”€ Notification click â”€â”€
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var targetUrl = 'https://chunhua1780.github.io/ghostchat/';
  if(e.notification.data && e.notification.data.url) targetUrl = e.notification.data.url;
  if(e.notification.launchURL) targetUrl = e.notification.launchURL;
  e.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(clients){
      for(var i=0;i<clients.length;i++){
        var c=clients[i];
        if(c.url.indexOf('chunhua1780.github.io/ghostchat') >= 0 && 'focus' in c){
          c.postMessage({type:'deeplink',url:targetUrl});
          return c.focus();
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// â”€â”€ Web Push â”€â”€
self.addEventListener('push', function(e){
  if(!e.data) return;
  var data = {};
  try{data = e.data.json();}catch(err){data = {title:'ðŸ’¬ æ–°æ¶ˆæ¯', body: e.data.text()};}
  e.waitUntil(
    self.registration.showNotification(data.title||'ðŸ’¬ GhostChat', {
      body: data.body||'ä½ æ”¶åˆ°äº†ä¸€æ¡æ–°æ¶ˆæ¯',
      icon: './icon192.png', badge: './icon192.png',
      tag: data.tag||'gc-msg', renotify: true, silent: false,
      requireInteraction: false, data: {url: data.url||'https://chunhua1780.github.io/ghostchat/'}
    })
  );
});

