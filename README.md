# 🌌 Aurora

**A premium, single-file subscription page template for the [Rebecca panel](https://github.com/rebeccapanel/Rebecca) (`dev` branch).**

Glassmorphism · usage dashboard · EN/FA RTL · white-label · Tailwind v4 + DaisyUI v5 + vanilla JS

---

## 📸 Preview

![Aurora subscription page](assets/screenshots/preview-v3.5.1.png)

*Aurora Dark — glassmorphism service card, usage/time rings, config list with protocol filters.*

---

## ✨ Features

- **Service card** — usage/time rings, animated stats, live quota-reset countdown. Handles unlimited, never-expire, `on_hold`, and client-derived expired/limited states.
- **Usage dashboard** — 30-day chart, threshold alerts, per-server breakdown, depletion forecast, offline cache, 5-min auto-refresh. Lazy-loaded via IntersectionObserver.
- **Configs** — search, protocol filters, group-by-country, bulk select + copy, `.txt`/`.json` export, full keyboard support. Web Share API button on mobile.
- **VPN files** (OpenVPN · WireGuard · L2TP/IPsec · PPTP · IKEv2 · Cisco AnyConnect) — download/copy `.ovpn` profiles and masked credential cards, fed by the panel's `/info` endpoint; WireGuard gets its own structured tab with download, copy-link, copy-config, and **Connect** button (`wireguard://`); IKEv2 and AnyConnect support password and certificate auth. Lazy-loaded.
- **Apps** — OS-grouped client catalogue with one-tap import (from `src/apps.json`).
- **Themes & i18n** — 4 themes, EN/FA/RU/ZH with full RTL, auto OS theme sync.
- **White-label** — brand text from panel profile title with fallbacks.
- **PWA-ready & resilient** — self-contained, offline cache, error boundaries, ARIA support.

One self-contained `index.html` — zero external requests at runtime.

---

## 🚀 Installation on Rebecca

In **Master Settings → Subscriptions**, drop the latest build at
`/var/lib/rebecca/templates/subscription/index.html`:

```bash
wget -O /var/lib/rebecca/templates/subscription/index.html \
  https://github.com/Ho3einK84/Aurora/releases/latest/download/index.html
```

---

## 📡 Shared Hosting Proxy

Extract `hosting.zip` from the latest release to your web root, and set your panel URL in `config.php`:

```php
'panel_url' => 'https://panel.example.com:8443',
```

---

## 🎨 Customization

- **White-label**: Edit `window.AURORA_BRAND` JSON literal in `dist/index.html` or `src/brand.json`.
- **Apps**: Edit `window.AURORA_APPS` in `dist/index.html` or `src/apps.json`.

---

## 🛠 Development

```bash
npm ci
npm run build      # → dist/index.html
npm run serve      # preview at http://localhost:8787
npm run guard      # re-verify directive guard
```

---

## 📄 License

MIT
