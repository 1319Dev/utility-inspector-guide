# Trench Slope Guide

Mobile-first **progressive web app** that puts your phone’s rear camera behind translucent **OSHA Type A / B / C** trench slope guides so you can visually align a trench face in the field.

> **Educational / field reference only.** Not engineering advice. A competent person must classify soil and select protective systems per OSHA and your employer’s program.

## Features

- Live rear camera (`getUserMedia` · `facingMode: environment`)
- Soil picker: **Type A** (¾:1 ≈53°), **Type B** (1:1 ≈45°), **Type C** (1½:1 ≈34°)
- Translucent slope overlays with H:V labels and angle callouts
- Drag yellow baseline / anchor; pinch or use **Scale** to fit the trench
- **Both walls** or single wall (**Flip side**)
- **Measure** clinometer mode: hold the phone on the soil face and compare measured angle vs OSHA allowed max for the selected soil type (PASS / TOO STEEP), with Freeze
- Installable PWA with offline cache after first visit
- Large, high-contrast, glove-friendly controls

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL on your **phone** (same Wi‑Fi), or use a tunnel. Camera requires **HTTPS** (or `localhost`).

```bash
npm run build    # output in dist/
npm run preview  # serve the production build
```

## Deploy (phone-ready URL)

Any static host works. After `npm run build`, publish the `dist/` folder.

### GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Deploy from a branch, folder `/ (root)` **or** use a Pages action that publishes `dist/`.
3. If the site is at `https://<user>.github.io/trench-slope-guide/`, the project already uses relative asset paths (`base: './'` in Vite).
4. On your phone: open the Pages URL → **Start camera** → optionally **Add to Home Screen**.

### Other hosts

Netlify, Cloudflare Pages, Vercel, S3, etc.: set the publish directory to `dist`.

## Field use

1. Allow camera permission.
2. Select soil type (A / B / C).
3. Drag the yellow baseline to the trench toe (or crest).
4. Scale / pinch so the colored slope line matches the expected OSHA face.
5. Compare the real wall to the guide — steeper than the guide may need more cut or another protective system.
6. Optional: tap **Measure**, allow motion access, hold the phone flat against the face (long edge up the slope). Compare **Measured** to **Allowed max**; freeze a reading if needed.

## OSHA slopes used

| Soil   | Max slope (H:V) | ≈ angle from horizontal |
|--------|-----------------|-------------------------|
| Type A | ¾ : 1           | ≈ 53°                   |
| Type B | 1 : 1           | ≈ 45°                   |
| Type C | 1½ : 1          | ≈ 34°                   |

Angles are `atan(1 / H)` for H:V = H:1. Confirm against current OSHA excavation standards for your situation.

## Stack

Vite + vanilla HTML / CSS / JS. No framework. Service worker + web manifest in `public/`.

## License

Use freely for safety training and field reference. No warranty.
