'use strict';

var CACHE_VERSION='ballnote-v031-shell-20260923-1';
var SHELL=['./index.html','./manifest.webmanifest'];

self.addEventListener('install',function(event){
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return cache.addAll(SHELL);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate',function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(key){
        if((key.indexOf('ballnote-v030-shell-')===0||key.indexOf('ballnote-v031-shell-')===0)&&key!==CACHE_VERSION){
          return caches.delete(key);
        }
      }));
    }).then(function(){
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch',function(event){
  var req=event.request;
  if(req.method!=='GET')return;
  var url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req).then(function(res){
        if(res&&res.ok){
          var copy=res.clone();
          caches.open(CACHE_VERSION).then(function(cache){
            cache.put('./index.html',copy);
          });
        }
        return res;
      }).catch(function(){
        return caches.match('./index.html').then(function(cached){
          return cached||Response.error();
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function(cached){
      if(cached)return cached;
      return fetch(req).then(function(res){
        if(res&&res.ok){
          var copy=res.clone();
          caches.open(CACHE_VERSION).then(function(cache){
            cache.put(req,copy);
          });
        }
        return res;
      });
    })
  );
});
