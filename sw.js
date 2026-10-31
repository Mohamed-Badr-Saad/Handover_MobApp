/* Plant Handover - service worker.
   Keeps the app itself (pages, styles, scripts, icons) on the phone so it
   opens instantly and still shows its screens without a connection.
   Data never goes through this cache: Supabase requests pass straight by.
   Change VERSION whenever any app file changes - phones then pick up the new
   files and the app offers "Reload". */
var VERSION = "ph-2026-10-31-8";
var SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "css/mobile.css",
  "js/config.js",
  "js/i18n.js",
  "js/core.js",
  "js/seed-staff.js",
  "js/vendor/supabase.js",
  "js/store.js",
  "js/views.js",
  "js/move.js",
  "js/app.js",
  "img/rashpetco.png",
  "img/shell.png",
  "img/icon-192.png",
  "img/icon-512.png",
  "img/icon-favicon.png",
  "img/apple-touch-icon.png"
];
/* Loaded only when needed (imports / templates), then kept. */
var LATER = ["js/vendor/xlsx.full.min.js", "js/import-template.js"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); }));
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (event) {
  if (event.data === "skip-waiting") { self.skipWaiting(); }
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") { return; }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }            // Supabase etc.: straight to the network

  if (req.mode === "navigate") {
    // Page: fresh when online, the saved copy when not.
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match("index.html", { ignoreSearch: true });
      })
    );
    return;
  }

  // App files: the saved copy (versioned), else the network, saved for next time.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) { return hit; }
      return fetch(req).then(function (res) {
        if (res && res.ok && (SHELL.concat(LATER).some(function (u) { return url.pathname.endsWith("/" + u); }))) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
