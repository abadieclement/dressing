/* Service worker : ouverture hors ligne et photos en cache. */
importScripts("config.js");
var CFG = self.DRESSING_CONFIG || {};
var VERSION = "dressing-v2";
var PHOTOS = "dressing-photos-v1";
var SHELL = ["./", "index.html", "config.js", "shim.js", "vendor/supabase.js", "vendor/jszip.min.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== PHOTOS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function photo(req, path) {
  return caches.open(PHOTOS).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(CFG.url + "/storage/v1/object/public/photos/" + path).then(function (r) {
        if (r.ok) c.put(req, r.clone());
        return r;
      });
    });
  });
}
function shell(req) {
  return fetch(req, { cache: "no-cache" }).then(function (r) {
    if (r.ok) { var copy = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
    return r;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match("index.html"); });
  });
}
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var base = new URL("./", self.registration.scope).pathname;
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf(base + "blob/") === 0) {
      e.respondWith(photo(req, url.pathname.slice((base + "blob/").length)));
    } else {
      e.respondWith(shell(req));
    }
  }
});
