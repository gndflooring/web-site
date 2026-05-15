# G&D Flooring — Website

A modern, single-page marketing site for **G&D Flooring**, a premium flooring &
renovation contractor. Built with **Vite** and **Tailwind CSS v4**, with subtle
scroll-reveal animations and a color palette inspired by the Guatemalan flag
(sky blue + white), warmed with wood/sand gold tones for a premium feel.

## Tech stack

- [Vite 7](https://vite.dev/) — build tooling & dev server
- [Tailwind CSS v4](https://tailwindcss.com/) — styling via `@tailwindcss/vite`
- Vanilla JS — IntersectionObserver scroll reveals, sticky header, mobile menu,
  active-nav highlighting, subtle hero parallax (all respect
  `prefers-reduced-motion`)
- Fonts: Fraunces (display) + Inter (body), loaded from Google Fonts

## Local development

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # production build → dist/
npm run preview  # serve the production build locally
```

## Project structure

```
index.html               # the whole page (semantic sections)
src/
  style.css              # Tailwind import + design tokens (@theme) + animations
  main.js                # scroll reveals, header, mobile menu, parallax
public/
  CNAME                  # custom domain: www.gnd-flooring.com
  .nojekyll              # disables Jekyll on GitHub Pages
  favicon.svg
  images/*.svg           # PLACEHOLDER imagery — swap with real photos
.github/workflows/deploy.yml   # CI: build + deploy to GitHub Pages
```

## Placeholders to replace before launch

All placeholder content is clearly marked. Before going live, replace:

- **Imagery** — every file in `public/images/` is a generated SVG placeholder.
  Drop in real photos (keep the same filenames, or update the `src` paths in
  `index.html`). Recommended: hero ≈ 1600×1000, service cards ≈ 4:3,
  gallery a mix of portrait/landscape.
- **Business details** — phone `(555) 123-4567`, email
  `hello@gnd-flooring.com`, address, hours, service area, license number.
  These appear in `index.html` (contact section, footer, and the JSON-LD
  structured-data block in `<head>`).
- **Contact form** — currently a `mailto:` placeholder. Connect it to a form
  service (Formspree, Netlify Forms, Basin, etc.) before launch.
- **Testimonials** — replace the placeholder names/quotes.

## Deploying to GitHub Pages (www.gnd-flooring.com)

The included workflow (`.github/workflows/deploy.yml`) builds the site and
deploys it to GitHub Pages on every push to `main`.

**One-time setup:**

1. Push this repo to GitHub.
2. In the repo: **Settings → Pages → Build and deployment → Source** = **GitHub Actions**.
3. In the repo: **Settings → Pages → Custom domain** = `www.gnd-flooring.com`,
   then enable **Enforce HTTPS** (the `public/CNAME` file already sets this, but
   confirm it in the UI).
4. Configure DNS at your domain registrar:
   - A **CNAME** record: `www` → `<your-github-username>.github.io`
   - To make the apex `gnd-flooring.com` redirect to `www`, add the four GitHub
     Pages **A records** for the apex (`185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`) — or an `ALIAS`/`ANAME` if your
     registrar supports it.
5. Push to `main` — the **Deploy to GitHub Pages** action runs automatically.
   You can also trigger it manually from the **Actions** tab.

DNS propagation and the GitHub TLS certificate can take up to ~24h on first
setup.
