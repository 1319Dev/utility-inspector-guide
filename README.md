# Utility Inspector Guide

Mobile-first **progressive web app** — a field toolkit for utility inspectors. Hub home screen with glove-friendly tiles for trench slope overlays, stamped photos, bell hole checklist, Station Locator (KMZ live/pin), Scope of Work PDF search with page highlights, daily progress report, depth of cover, 811 checklist, daily trench card, pressure log, confined-space timer, Weather Radar (keyless NEXRAD / optional RainViewer + Blitzortung lightning), emergency contacts, and material lookups.

> **Educational / field reference only.** Not engineering advice. A competent person must classify soil and select protective systems per OSHA and your employer’s program. Confirm clearances and cover mins against company standards and codes.

## Tools

1. **Trench Slope** — live rear camera + OSHA Type A / B / C slope overlays; clinometer **Measure** (PASS / TOO STEEP)
2. **Photo Stamp** — capture/pick photo; **autofills station** from Station Locator (live estimate or saved); stamp datetime, GPS, station, pipe size/material, soil, inspector, note; download
3. **Bell Hole** — rear camera + approval checklist; **autofills station** from Station Locator; stamp Pass / Needs work / Fail; export photo + text/JSON (field aid only)
4. **Depth of Cover** — probe/tape entry (recommended); phone two-tap barometer/GPS estimate with honesty checks; trench depth vs min cover (gas 24″ / water 36″ / custom)
5. **811 / Locate** — APWA paint color legend + pre-dig checklist (ticket, marks verified, etc.)
6. **Daily Trench Card** — soil, protective system, spoil ≥2 ft, egress ≤25 ft, competent person; export/share text
7. **Pressure / Soap Test Log** — pressure, hold, start/end, pass/fail; export CSV/JSON
8. **Confined Space Timer** — count-up with interval alarm or countdown; manual O₂/LEL/H₂S/CO fields
9. **Emergency** — editable contacts + nearest ER note (on-device)
10. **Lookups** — PE/steel size tables + material ID cheat sheet (PE, steel, DI, PVC, copper)
11. **Scope of Work** — upload PDF / TXT / MD / DOCX; **preview pages**; search; tap a hit to open that PDF page with highlights (IndexedDB)
12. **Daily Report** — digital Daily Progress Report (phases, footage, hours); **Save PDF** fills company AcroForm via pdf-lib; also HTML/text export
13. **Station Locator** — upload Google Earth KMZ/KML; **Live estimate** (smoothed interpolated station while walking) or **Pin only** (nearest 100-ft placemark); mode + station saved for Photo Stamp / Daily Report / Bell Hole autofill
14. **Weather Radar** — WeatherBug-style Leaflet map: free keyless NOAA NEXRAD via Iowa State Mesonet (default), optional RainViewer global, GPS pin + 10/30 mi rings, live Blitzortung lightning, NWS warning overlay

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL on your **phone** (same Wi‑Fi), or use a tunnel. Camera / motion require **HTTPS** (or `localhost`).

```bash
npm run build    # output in dist/
npm run preview  # serve the production build
```

## Deploy

Any static host works. After `npm run build`, publish the `dist/` folder.

### GitHub Pages

Repo path can remain `trench-slope-guide`; Vite uses `base: './'`. Live example:

`https://garrett1319.github.io/trench-slope-guide/`

On your phone: open the URL → **Add to Home Screen**. Service worker cache is `utility-inspector-guide-v15` (network-first HTML).

## Data privacy

Settings, checklists, and logs are stored in **localStorage on the device**. Uploaded Scope of Work text and Station Locator KMZ parses are stored in **IndexedDB on the device**. Nothing is uploaded to a server by the app.

## Stack

Vite + vanilla HTML / CSS / JS modules. **pdf-lib** fills the Daily Progress Report AcroForm on export. Service worker + web manifest in `public/`.

## License

Use freely for safety training and field reference. No warranty.
