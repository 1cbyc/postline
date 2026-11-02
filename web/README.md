# postline.nsisong.com

The postline website and documentation. It runs as a Cloudflare Worker that
serves static assets only (no Worker script, no Pages).

The docs pages are built from `docs/guides/*.md`, so the site and the repository
never drift apart. Add a guide there, then add it to `GUIDES` in
`scripts/build.ts`; the build fails if a guide isn't listed.

## Commands

```sh
cd web
npm install
npm run build     # writes dist/
npm run check     # type-checks the build script
npm run dev       # build, then serve on http://localhost:8787 with wrangler
npm run deploy    # build, then deploy to Cloudflare
```

Node 22.6 or newer runs `scripts/build.ts` directly (with `--experimental-strip-types`).

## Layout

| Path | What it is |
| --- | --- |
| `src/index.html`, `src/404.html` | Page bodies for the home and not-found pages |
| `src/templates/layout.html` | Shared header, footer and `<head>` |
| `src/templates/doc.html` | Guide page: sidebar, content, on-this-page list |
| `src/assets/` | Copied to `dist/` as is: CSS, JS, favicon, `_headers`, `robots.txt` |
| `scripts/build.ts` | Renders everything into `dist/`, plus `sitemap.xml` |
| `wrangler.jsonc` | Worker name, assets settings and the `postline.nsisong.com` custom domain |

`_headers` sets the security headers (CSP, HSTS and friends). If you add a
third-party script, font or image host, update the CSP there.

## Deploying

The repository is connected to the `postline` Worker with Cloudflare Workers
Builds, so pushes to `main` deploy automatically. Its build settings
(Worker > Settings > Builds) must be:

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler preview` (needs the `previews` block in `wrangler.jsonc`) |

To deploy by hand instead, run `npm run deploy`. It attaches `postline.nsisong.com`
as a custom domain, so the `nsisong.com` zone must be in the account set by
`account_id` in `wrangler.jsonc`. Cloudflare creates the DNS record and certificate.
