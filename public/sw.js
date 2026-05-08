self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("dealer-flow-v2").then((cache) => cache.addAll(["/", "/dashboard", "/vehicles", "/manifest.webmanifest", "/icon.svg"])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== "dealer-flow-v2").map((key) => caches.delete(key)))),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.url.includes("/api/")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
