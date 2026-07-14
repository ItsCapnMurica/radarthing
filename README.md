# DriveRadar

A static, single-purpose site: turn-by-turn driving directions with spoken
voice guidance, plus a live weather radar overlay. No backend, no server costs.

## Stack (all free, no credit card required anywhere)

- **Leaflet.js** — map rendering
- **CARTO dark tiles** — basemap
- **Nominatim (OpenStreetMap)** — address search / geocoding
- **OpenRouteService** — driving route + turn-by-turn steps (free tier: 2,000 requests/day)
- **RainViewer** — live radar tiles, refreshes every 5 minutes
- **Web Speech API** — built into the browser, speaks each turn as you approach it

## Setup

1. Create a new GitHub repo (public, since GitHub Pages is free for public repos).
2. Push these files: `index.html`, `style.css`, `app.js`, `config.js`.
3. In the repo: **Settings → Pages → Source → Deploy from branch → main / root**.
4. Wait a minute, then visit `https://<your-username>.github.io/<repo-name>/`
   (or point your own DuckDNS domain at it with a CNAME file — see below).

## Getting a routing key

Routing requires a free OpenRouteService key:

1. Sign up at https://openrouteservice.org/dev/#/signup (no card needed).
2. Create a token, copy it.
3. Open the site, paste the key into the "Add your API key" box.
   It's saved with `localStorage` **only in your browser** — it is never
   committed to the repo or sent anywhere except OpenRouteService's API.

If you want it pre-filled for every visitor of your own personal site instead
of asking each person to paste their own key, you can hardcode it in
`config.js` — just know that means it's visible to anyone who views source.
Since ORS free-tier keys are rate-limited (not billable), that's a low-risk
tradeoff for a personal project, unlike a Google Maps key tied to a card.

## Using your own domain (e.g. landonbio-style DuckDNS setup)

Add a file named `CNAME` (no extension) at the repo root containing just your
domain, e.g.:

```
driveradar.duckdns.org
```

Then point the DuckDNS domain's CNAME record at `<your-username>.github.io`.
GitHub Pages will serve the site from your custom domain automatically.

## Notes / limitations

- Voice guidance triggers based on your live GPS position (`watchPosition`),
  so it only works meaningfully while actually moving/driving with location
  permission granted — it won't "simulate" a drive.
- Nominatim asks that you not hammer it with rapid automated requests; normal
  personal use is fine.
- Radar is composite (not hyper-local like a dedicated weather app), refreshed
  every 5 minutes — good enough for "is a storm coming" context while driving.
