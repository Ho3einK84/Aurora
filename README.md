<div align="center">

# 🌌 Aurora

**A premium, single-file subscription page template for the [Rebecca panel](https://github.com/rebeccapanel/Rebecca) (`dev` branch).**

Northern-lights aesthetics · glassmorphism · radial usage rings · one-tap app import · QR codes · EN/FA with full RTL.

Tailwind CSS v4 · DaisyUI v5 · Alpine.js v3 · qrcode-generator

</div>

---

## ✨ Features

- **Service info card** — username, status, used/total/remaining traffic with an animated radial + linear progress, expiry date and days remaining. Handles **unlimited traffic** and **never-expire** gracefully.
- **Apps section** — recommended clients grouped by OS (iOS / Android / Windows / macOS / Linux) with a **one-tap import** deep link (the subscription URL is injected into each app's URL scheme) and a download link. Driven by `apps.json`.
- **Configs section** — every config from the subscription with copy-to-clipboard and a **QR-code modal**, plus *copy subscription link* and *copy all configs*.
- **Theme switcher** — Aurora (dark), Aurora Light, Nord, Dracula, Synthwave. Preference persists via localStorage → cookie → in-memory, and reads `?theme=` / `?lang=` from the URL. Never *requires* storage.
- **Language switcher** — English / فارسی with full RTL (`dir`, mirrored layout, Vazirmatn font, localized digits).
- **Edge cases** — expired / limited / disabled banners, empty "no configs" state, and a no-flash (`x-cloak`) load.

Everything ships as **one self-contained `index.html`** (CSS inlined; Alpine + qrcode from pinned CDNs).

---

## 🚀 Installation on Rebecca

> **Verified against Rebecca `dev`.** Rebecca is a Go rewrite of Marzban that renders the subscription page with **pongo2** (Django/Jinja2-compatible). The template is read from disk **on every request and re-parsed each time — so no restart is needed**; replacing the file takes effect immediately.

Rebecca does **not** use Marzban's `CUSTOM_TEMPLATES_DIRECTORY` / `SUBSCRIPTION_PAGE_TEMPLATE` env vars. Instead it uses:

| What | Where | Default |
|---|---|---|
| Template filename | DB column `subscription_settings.subscription_page_template` | `subscription/index.html` |
| Custom templates dir | DB column `subscription_settings.custom_templates_directory` | *(unset)* |
| App template base | env `REBECCA_APP_TEMPLATE_BASE` | `/opt/rebecca/templates` |
| Data dir | env `REBECCA_DATA_DIR` | `/var/lib/rebecca` |

### Option A — drop into the data directory (recommended)

This keeps your custom template separate from the bundled defaults, so panel updates won't overwrite it.

```bash
# create the folder, then download the latest build
mkdir -p /var/lib/rebecca/templates/subscription
wget -O /var/lib/rebecca/templates/subscription/index.html \
  https://github.com/Ho3einK84/Aurora/releases/latest/download/index.html
```

Then point Rebecca at that directory **once**. The panel's template editor does this automatically the first time you save a template; alternatively set it via the settings API:

```bash
# update subscription settings (use your own admin token & host)
curl -X PUT https://YOUR_PANEL/api/subscription/settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"custom_templates_directory":"/var/lib/rebecca/templates","subscription_page_template":"subscription/index.html"}'
```

> If your `REBECCA_DATA_DIR` differs, substitute it. The resolved path is always `<custom_templates_directory>/subscription/index.html`.

### Option B — overwrite the bundled template

Replaces the default that ships with the panel. Simpler, but a panel reinstall/update may overwrite it.

```bash
wget -O /opt/rebecca/templates/subscription/index.html \
  https://github.com/Ho3einK84/Aurora/releases/latest/download/index.html
```
*(Substitute `REBECCA_APP_TEMPLATE_BASE` if you set it to something other than `/opt/rebecca/templates`.)*

### Verify

Open any user's subscription URL in a browser (the HTML page is served when the request `Accept`s `text/html` and has no `?client_type`). You should see the Aurora page. No service restart required.

### Updating

Re-run the same `wget` command — the new file is picked up on the next page load.

---

## 🎨 Customization

### Apps list (`src/apps.json`)

Edit `src/apps.json` and rebuild. Schema (mirrors Ourenus):

```json
{
  "name": "Hiddify",
  "urlScheme": "hiddify://import/{url}",
  "image": "https://…/icon.png",
  "link": "https://…/download",
  "os": ["Android", "iOS", "Windows", "macOS", "Linux"],
  "downloadLinks": { "Android": "https://…", "iOS": "https://…" },
  "ShowInMenu": true
}
```

`{url}` in `urlScheme` is replaced with the URL-encoded subscription URL; set `ShowInMenu: false` to hide an entry.

> **No-rebuild updates:** set `AURORA_APPS_REMOTE_URL` at the top of `src/app.js` to a hosted `apps.json` raw URL. At runtime Aurora fetches it and falls back to the bundled list if the request fails.

### Themes & colors

Themes live in `src/input.css` as DaisyUI `@plugin "daisyui/theme"` blocks (the signature `aurora` / `auroralight` palettes use OKLCH). Add or tweak a theme there, add it to the `themes:` line of `@plugin "daisyui"`, register it in the `AURORA_THEMES` array in `src/app.js`, then rebuild.

### Translations

`AURORA_I18N` in `src/app.js` holds the EN/FA strings — edit or add a language object (include a `dir`).

---

## 🛠 Building locally

```bash
npm ci
npm run build      # → dist/index.html (single self-contained file)
npm run dev        # watch Tailwind during development
```

The build (`scripts/build.mjs`):
1. compiles Tailwind v4 + DaisyUI v5 to minified CSS,
2. inlines the CSS and `app.js` (+ `apps.json` as `window.AURORA_APPS`) into `index.html`,
3. **guarantees every pongo2 `{{ }}` / `{% %}` placeholder is preserved byte-for-byte** (the build fails if the count changes).

CI (`.github/workflows/build.yml`) builds on push to `main` and on `v*` tags, and attaches `index.html` to the GitHub Release so `wget …/releases/latest/download/index.html` works.

---

## 🧩 Rebecca template context (reference)

The page binds to the real pongo2 context Rebecca passes (`internal/app/user/subscription.go`):

| Variable | Type | Notes |
|---|---|---|
| `user.username` | string | |
| `user.status` | string | `active` · `limited` · `expired` · `disabled` · `on_hold` |
| `user.status_class` | string | normalized class |
| `user.data_limit` | int64 bytes / falsy | falsy ⇒ unlimited |
| `user.used_traffic` | int64 bytes | |
| `user.expire` | int64 unix / falsy | falsy ⇒ never expires |
| `user.links` / `links` | []string | raw config URIs |
| `user.subscription_url` | string | primary sub URL |
| `usage_url`, `support_url`, `token` | string | |
| `remaining_days` | int64 | precomputed (no `now()` available) |

Filters available: `bytesformat`, `datetime`, `int`.

---

## License

MIT
