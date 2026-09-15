# Utility Inspector Guide

Mobile-first **progressive web app** — a field toolkit for utility inspectors. Hub home screen with glove-friendly tiles for trench slope overlays, stamped photos, cover/separation checks, 811 checklist, daily trench card, pressure log, confined-space timer, emergency contacts, and material lookups.

> **Educational / field reference only.** Not engineering advice. A competent person must classify soil and select protective systems per OSHA and your employer’s program. Confirm clearances and cover mins against company standards and codes.

## Tools

1. **Trench Slope** — live rear camera + OSHA Type A / B / C slope overlays; clinometer **Measure** (PASS / TOO STEEP)
2. **Photo Stamp** — capture/pick photo; stamp datetime, GPS, station, pipe size/material, soil, inspector, note; download
3. **Voice Note** — MediaRecorder + Web Speech transcript when available; recent notes in localStorage
4. **Depth of Cover** — trench depth or grade-to-top vs min cover (gas 24″ / water 36″ / custom)
5. **Separation Check** — measured distance vs required clearance presets (gas↔electric/water/sewer) or custom
6. **811 / Locate** — APWA paint color legend + pre-dig checklist (ticket, marks verified, etc.)
7. **Daily Trench Card** — soil, protective system, spoil ≥2 ft, egress ≤25 ft, competent person; export/share text
8. **Pressure / Soap Test Log** — pressure, hold, start/end, pass/fail; export CSV/JSON
9. **Confined Space Timer** — count-up with interval alarm or countdown; manual O₂/LEL/H₂S/CO fields
10. **Emergency** — editable contacts + nearest ER note (on-device)
11. **Lookups** — PE/steel size tables + material ID cheat sheet (PE, steel, DI, PVC, copper)

Offline maps / as-builts are deferred (future).

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

On your phone: open the URL → **Add to Home Screen**. Service worker cache is `utility-inspector-guide-v4` (network-first HTML).

## Data privacy

Settings, checklists, logs, and voice metadata are stored in **localStorage on the device**. Nothing is uploaded by the app.

## Stack

Vite + vanilla HTML / CSS / JS modules. Service worker + web manifest in `public/`.

## License

Use freely for safety training and field reference. No warranty.
