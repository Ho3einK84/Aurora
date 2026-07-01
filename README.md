<div align="center">

# 🌌 Aurora

**A premium, single-file subscription page template for the [Rebecca panel](https://github.com/rebeccapanel/Rebecca) (`dev` branch).**

Northern-lights aesthetics · glassmorphism · radial usage rings · usage-history dashboard · one-tap app import · QR codes · EN/FA with full RTL · white-label ready.

Tailwind CSS v4 · DaisyUI v5 · vanilla JS (esbuild) · Phosphor Icons · qrcode-generator

**⚡ Powered by Claude**

</div>

---

## 📸 Preview

<div align="center">

![Aurora subscription page](assets/screenshots/preview-v2.0.png)

*Version **2.0** — Aurora Dark.*

</div>

---

## ✨ Features

- **Service card** — dual progress rings (data usage + time remaining, with urgent glow near the limits), traffic stats with animated count-ups, expiry, and a **live quota-reset countdown** (daily/weekly/monthly/yearly). Handles unlimited, never-expire, and `on_hold` accounts; expired/limited states are also derived client-side when the server snapshot is stale.
- **Usage dashboard** — 30-day history chart fed by Rebecca's `usage_url`, with 50/80/90 % alerts, a **per-server breakdown**, a **depletion forecast** ("at this rate, data runs out …"), an offline-cached fallback, and auto-refresh every 5 minutes while the tab is visible.
- **Configs** — collapsible list with copy, per-config QR, copy-all, **live search**, **protocol filter pills**, **group-by-country** (flag detection from remarks), **bulk select + copy**, and **`.txt` export**. Full keyboard support: ↑/↓ to move, Enter to copy, Space for QR, `Ctrl/Cmd+Shift+C` to copy everything.
- **Apps** — OS-grouped client catalogue (Android / iOS / Windows / macOS / Linux) with one-tap import deep links and downloads from `src/apps.json`, lazily rendered on scroll.
- **Themes** — Aurora Dark, Amoled Dark, Aurora Light, Nord. Applied **before first paint** (no flash), persisted, and forceable via `?theme=nord`.
- **i18n** — English / فارسی with full RTL ([Arad](https://github.com/MDarvishi5124/Arad) font), localized digits, and Jalali dates; forceable via `?lang=fa`.
- **White-label** — the panel's `brand_name` binding drives the splash, header, title, and PWA manifest. No binding? Rebrand a built file in place — see below.
- **PWA-ready** — a manifest is registered at runtime (brand-named, theme-colored) so "Add to Home Screen" looks native.
- **Resilient** — **zero external requests**: CSS, fonts, icons, and all JS are inlined. Offline banner, visible error state if boot ever fails, and graceful expired/limited/disabled/on-hold/empty states.
- **Accessible** — ARIA labels throughout, focus-trapped native QR dialog, keyboard navigation, `prefers-reduced-motion` respected.

Everything ships as **one truly self-contained `index.html`** — no Google Fonts, no jsDelivr, no runtime network calls of any kind (the usage chart and optional remote catalogue talk only to *your* panel/host).

---

## 🚀 Installation on Rebecca

In the panel, open **Master Settings → Subscriptions**. The page is loaded from
`{Custom templates directory}/{Subscription page template}` — by default
`/var/lib/rebecca/templates/subscription/index.html`.

Drop the latest build at that path:

```bash
wget -O /var/lib/rebecca/templates/subscription/index.html \
  https://github.com/Ho3einK84/Aurora/releases/latest/download/index.html
```

Make sure **Subscription page template** is set to `subscription/index.html` (the
default). Alternatively, paste the file's contents into the **Template Creator** tab.

That's it. Rebecca re-reads the template on every request, so **no restart is
needed** — just open any user's subscription URL to see it.

### Updating

Re-run the same `wget` command (or re-paste it in **Template Creator**) — the new file is picked up on the next page load.

---

## 🎨 Customization

### White-label / rebranding without a rebuild

When Rebecca passes a `brand_name`, Aurora uses it everywhere automatically. If your
panel build doesn't provide one, the default ("Aurora") lives as plain text in the
built file and can be swapped on the server in one line:

```bash
sed -i 's/\bAurora\b/YourBrand/g' /var/lib/rebecca/templates/subscription/index.html
```

This rewrites the whole-word, case-sensitive `Aurora` — the `<title>`, splash,
header, and the `<meta name="aurora-brand">` default the app reads — while leaving
lowercase internals (`aurora-bg`, `aurora_theme`, …) untouched.

### Apps list (`src/apps.json`)

Edit `src/apps.json` and rebuild — or edit the plain `window.AURORA_APPS = […]`
JSON right inside a built `dist/index.html` (no rebuild needed). Schema:

```json
{
  "name": "Happ",
  "urlScheme": "happ://add/{url}",
  "os": ["Android", "iOS", "Windows", "macOS", "Linux"],
  "link": "https://happ.su/main/download",
  "downloadLinks": { "Android": "https://…", "iOS": "https://…" },
  "ShowInMenu": true
}
```

`urlScheme` placeholders, substituted at runtime:
`{url}` raw subscription URL · `{url_enc}` percent-encoded · `{url_b64}` base64 (Shadowrocket-style) · `{name}` username.

Bundled entries render a theme-aware letter tile; an optional `"image"` URL is
honoured (useful with remote catalogues).

> **No-rebuild updates:** set `AURORA_APPS_REMOTE_URL` at the top of `src/app.js` to a hosted `apps.json` raw URL. At runtime Aurora fetches it and falls back to the bundled list if the request fails.

### Themes & colors

Themes live in `src/input.css` as DaisyUI `@plugin "daisyui/theme"` blocks (OKLCH
palettes). Add or tweak a theme there, add it to the `themes:` line of
`@plugin "daisyui"`, register it in the `THEMES` array in `src/app.js` and the
theme list in the head resolver of `src/index.html`, then rebuild.

### Translations

`src/i18n.js` holds the EN/FA dictionaries — edit or add a language object
(include a `dir`).

---

## 🛠 Building locally

```bash
npm ci
npm run build      # → dist/index.html (single self-contained file)
npm run serve      # preview with sample data on http://localhost:8787
npm run guard      # re-verify the directive guard on an existing build
npm run dev        # watch Tailwind during development
```

The preview server emulates Rebecca's pongo2 rendering with sample data —
try `?state=expired|limited|disabled|on_hold|unlimited|forever|empty`,
`?lang=fa`, `?theme=amoleddark`, `?brand=YourBrand`. A sample `/usage`
endpoint feeds the dashboard (`USAGE=html` exercises the HTML-scrape fallback).

The build (`scripts/build.mjs`):
1. bundles + minifies the app (`src/app.js` + modules) with esbuild,
2. bundles the QR module **separately** — embedded as an inert base64 blob and only decoded/imported the first time a QR code is opened,
3. inlines the compiled Tailwind v4 + DaisyUI v5 CSS (only the components used), the web fonts (Inter **variable** + Arad as base64 `@font-face`), the Phosphor icons actually used (CSS mask data-URIs), and `apps.json` — producing a file with **no external requests**,
4. base64-encodes all executable JS so the template engine never sees code containing `{{`/`{%` (pongo2/Jinja2 would try to evaluate it and crash the render),
5. **enforces a directive allow-list**: the build fails if any directive appears outside the `#aurora-data` island, an unknown binding appears inside it, or anything references an external resource.

Fonts and libraries are pinned via `package-lock.json`, so `npm ci && npm run build` is fully reproducible and offline.

CI (`.github/workflows/build.yml`) builds and guards every push and PR, and attaches `index.html` to the GitHub Release on tags so `wget …/releases/latest/download/index.html` works.

---

## 🗂 Project structure

```
aurora/
├── src/
│   ├── index.html      # markup + the pongo2 data-island (the ONLY directives)
│   ├── app.js          # bootstrap, card, rings, countdown, theming, QR modal
│   ├── configs.js      # config parsing, search/filter/group/select, list view
│   ├── apps.js         # app catalogue, OS detection, import deep links
│   ├── usage.js        # usage dashboard: fetch, cache, chart, forecast
│   ├── i18n.js         # EN/FA dictionaries, digits, dates
│   ├── format.js       # bytes/number parsing + HTML escaping
│   ├── store.js        # preference store (localStorage → cookie → memory)
│   ├── ui.js           # DOM utilities, clipboard, toast, reveal, count-up
│   ├── qr.js           # lazy QR module (SVG renderer)
│   ├── input.css       # Tailwind + DaisyUI themes + Aurora components
│   └── apps.json       # OS-grouped client catalogue
├── assets/fonts/       # Arad woff2 (Inter comes from @fontsource-variable)
├── scripts/
│   ├── build.mjs       # bundle → inline → guard → dist/index.html
│   └── serve.mjs       # local preview with sample pongo2 data (dev only)
└── .github/workflows/build.yml
```

---

## 🧩 Rebecca template context (reference)

The page binds to the real pongo2 context Rebecca passes (`internal/app/user/subscription.go`):

| Variable | Type | Notes |
|---|---|---|
| `user.username` | string | |
| `user.status` | string | `active` · `limited` · `expired` · `disabled` · `on_hold` |
| `user.status_class` | string | normalized class |
| `user.data_limit` | int64 bytes / falsy | falsy ⇒ unlimited |
| `user.data_limit_reset_strategy` | string | `no_reset` · `day` · `week` · `month` · `year` |
| `user.used_traffic` | int64 bytes | |
| `user.expire` | int64 unix / falsy | falsy ⇒ never expires |
| `user.online_count` | int | shown as a presence badge when > 0 |
| `user.service_name` | string | optional service label |
| `user.links` / `links` | []string | raw config URIs |
| `user.subscription_url` | string | primary sub URL |
| `usage_url`, `support_url` | string | usage feeds the dashboard |
| `brand_name` | string | white-label name (optional) |
| `remaining_days` | int64 | precomputed fallback (live value derived from `expire`) |

All `now()`-based logic (countdowns, ring depletion, forecasts) runs client-side.

---

## License

MIT
