<div align="center">

# 🌌 Aurora

**A premium, single-file subscription page template for the [Rebecca panel](https://github.com/rebeccapanel/Rebecca) (`dev` branch).**

Northern-lights aesthetics · glassmorphism · radial usage rings · one-tap app import · QR codes · EN/FA with full RTL.

Tailwind CSS v4 · DaisyUI v5 · Alpine.js v3 · Phosphor Icons · qrcode-generator

**⚡ Powered by Claude**

</div>

---

## ✨ Features

- **Service info card** — username, status, and **dual progress rings** (data usage % + time remaining) with a faintly-visible unfilled track, plus used/total/remaining traffic, a linear usage bar, and the expiry date. Handles **unlimited traffic** and **never-expire** gracefully.
- **Apps section** — a **collapsible** card of recommended clients with a **horizontally scrollable** OS strip (iOS / Android / Windows / macOS / Linux) and a **vertically scrollable** app list on mobile. Each app has a **one-tap import** deep link (the subscription URL is injected into the app's URL scheme) and a download button. Driven by `apps.json`.
- **Configs section** — a **collapsible** card listing every config with copy-to-clipboard and a **QR-code modal**, plus *copy subscription link*, *copy all configs*, and a dedicated **QR code of the subscription link**.
- **Theme switcher** — Aurora Dark, Amoled Dark, Aurora Light, Nord. Preference persists via localStorage → cookie → in-memory, and reads `?theme=` / `?lang=` from the URL. Never *requires* storage.
- **Language switcher** — English / فارسی with full RTL (`dir`, mirrored layout, [Arad](https://github.com/MDarvishi5124/Arad) font, localized digits).
- **Loading splash** — a lightweight branded loader shows instantly (CSS-only, before Alpine boots) and fades out once ready, with a safety timeout so it never traps the page. Images lazy-load (`loading="lazy"` + async decode).
- **Edge cases** — expired / limited / disabled banners, empty "no configs" state, and a no-flash (`x-cloak`) load.

Everything ships as **one self-contained `index.html`** (CSS inlined; Alpine + qrcode from pinned CDNs).

---

## 🚀 Installation on Rebecca

In the panel, open **Master Settings → Subscriptions**. The page is loaded from
`{Custom templates directory}/{Subscription page template}` — by default
`/var/lib/rebecca/templates/subscription/index.html`.

1. Download the latest `index.html` from the [**Releases**](https://github.com/Ho3einK84/Aurora/releases/latest) page.
2. Put it at that path — either save the file directly to
   `<Custom templates directory>/subscription/index.html`, or paste its contents
   into the **Template Creator** tab and save.
3. Make sure **Subscription page template** is set to `subscription/index.html`
   (the default).

That's it. Rebecca re-reads the template on every request, so **no restart is
needed** — just open any user's subscription URL to see it.

### Updating

Replace the same file (or re-paste it in **Template Creator**) with the newer release.

---

## 🎨 Customization

### Apps list (`src/apps.json`)

Edit `src/apps.json` and rebuild. Schema (mirrors Ourenus):

```json
{
  "name": "Happ",
  "urlScheme": "happ://add/{url}",
  "image": "https://happ.su/img/logo.png",
  "link": "https://happ.su/main/download",
  "os": ["Android", "iOS", "Windows", "Linux"],
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
