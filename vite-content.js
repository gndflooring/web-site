// Build-time content injection. Replaces marked regions in index.html with
// HTML generated from src/content/site.json. Runs in dev (serve) too, so
// editing site.json and reloading reflects changes locally. Generators
// reproduce the original markup exactly when site.json holds the seed values,
// guaranteeing pixel parity.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const arrowSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
const svcArrow =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="transition-transform duration-300 group-hover:translate-x-1"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
const featureIcons = [
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 2.4 5 5.6.8-4 4 1 5.6L12 19l-5 2.4 1-5.6-4-4 5.6-.8z"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
]
const ri = (i) => (i ? ` style="--reveal-i: ${i}"` : '')

const parseMd = (s, bgContext = 'light') => {
  if (!s) return ''
  let text = esc(s)
  let hl = 'text-brand-600 font-semibold'
  if (bgContext === 'dark') hl = 'text-sand-300 font-semibold'
  else if (bgContext === 'sand' || bgContext === 'gold') hl = 'text-teal-900 font-bold'
  else if (bgContext === 'eyebrow-light') hl = 'text-teal-700 font-bold'

  text = text.replace(/\*([^*]+)\*/g, `<span class="italic ${hl}">$1</span>`)
  text = text.replace(/\*\*([^*]+)\*\*/g, `<strong class="font-bold">$1</strong>`)
  text = text.replace(/_([^_]+)_/g, `<em class="italic">$1</em>`)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" class="underline hover:opacity-80">$1</a>`)
  return text
}

const gen = {
  'meta.title': (c) => esc(c.meta.title),
  'meta.description': (c) => esc(c.meta.description),
  'meta.ogTitle': (c) => esc(c.meta.ogTitle),
  'meta.ogDescription': (c) => esc(c.meta.ogDescription),
  'hero.image': (c) => esc(c.hero?.image),
  'footer.note': (c) => parseMd(c.footer.note, 'dark'),

  hero: (c) => {
    const h = c.hero
    const headline = h.headline || `${h.headlineLead || ''} *${h.highlight || ''}* ${h.headlineRest || ''}`
    return `<div class="max-w-3xl">
            <p class="eyebrow reveal text-sand-300">
              <span class="h-px w-8 bg-sand-300"></span>
              ${parseMd(h.eyebrow, 'dark')}
            </p>
            <h1 class="reveal mt-6 font-display text-5xl font-600 leading-[1.05] text-white sm:text-6xl lg:text-7xl"${ri(1)}>
              ${parseMd(headline, 'dark')}
            </h1>
            <p class="reveal mt-7 max-w-xl text-lg leading-relaxed text-white/80"${ri(2)}>
              ${parseMd(h.subcopy, 'dark')}
            </p>
            <div class="reveal mt-10 flex flex-wrap items-center gap-4"${ri(3)}>
              <a href="#contact" class="btn-gold">${parseMd(h.ctaPrimary, 'gold')}</a>
              <a href="#services" class="btn-ghost">
                ${parseMd(h.ctaSecondary, 'dark')}
                ${arrowSvg}
              </a>
            </div>
            <dl class="reveal mt-16 flex flex-wrap gap-8 border-t border-white/15 pt-8"${ri(4)}>
              ${(h.stats || [])
                .map(
                  (s) =>
                    `<div><dt class="text-sm text-white/60">${parseMd(s.label, 'dark')}:</dt><dd class="font-display text-3xl font-600 text-white mt-1">${parseMd(s.value, 'dark')}</dd></div>`
                )
                .join('')}
            </dl>
          </div>`
  },

  trust: (c) => {
    const sep = '<span class="hidden h-4 w-px bg-ink/15 sm:block"></span>'
    return (c.trust || [])
      .map((t, i) => `<span class="reveal"${ri(i)}>${parseMd(t, 'sand')}</span>`)
      .join(sep)
  },

  services: (c) => {
    const s = c.services
    return `<div class="mx-auto max-w-2xl text-center">
            <p class="eyebrow reveal justify-center">
              <span class="h-px w-8 bg-brand-600"></span>
              ${parseMd(s.eyebrow, 'eyebrow-light')}
              <span class="h-px w-8 bg-brand-600"></span>
            </p>
            <h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>
              ${parseMd(s.heading, 'light')}
            </h2>
            <p class="reveal mt-5 text-lg text-muted"${ri(2)}>
              ${parseMd(s.subcopy, 'light')}
            </p>
          </div>

          <div class="mt-16 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
            ${s.items
              .map(
                (it, i) => `<article class="card-lift reveal group overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-ink/5"${ri(i)}>
              <div class="media-zoom relative aspect-[4/3] overflow-hidden">
                <img src="${esc(it.image)}" alt="${esc(it.alt)}" class="h-full w-full object-cover" loading="lazy" />
              </div>
              <div class="p-7">
                <h3 class="font-display text-xl font-600 text-ink">${parseMd(it.title, 'light')}</h3>
                <p class="mt-3 text-sm leading-relaxed text-muted">${parseMd(it.desc, 'light')}</p>
                <ul class="mt-5 space-y-2 text-sm text-ink-700">
                  ${(it.bullets || [])
                    .map(
                      (b) =>
                        `<li class="flex items-center gap-2"><span class="text-brand-600">✓</span> ${parseMd(b, 'light')}</li>`
                    )
                    .join('')}
                </ul>
                <a href="#contact" class="mt-6 inline-flex items-center gap-1.5 text-sm font-600 text-brand-700">
                  Request this service
                  ${svcArrow}
                </a>
              </div>
            </article>`
              )
              .join('')}
          </div>`
  },

  about: (c) => {
    const a = c.about
    return `<div class="reveal relative">
            <div class="media-zoom overflow-hidden rounded-[2rem] shadow-lift">
              <img src="${esc(a.image)}" alt="${esc(a.alt)}" class="aspect-[4/5] w-full object-cover" loading="lazy" />
            </div>
            <div class="absolute -bottom-7 -right-3 hidden rounded-2xl bg-sand-400 p-6 text-ink shadow-lift sm:block lg:-right-7">
              <p class="font-display text-3xl font-700">${parseMd(a.badgeValue, 'sand')}</p>
              <p class="text-xs font-600 uppercase tracking-wider">${parseMd(a.badgeLabel, 'sand')}</p>
            </div>
          </div>

          <div>
            <p class="eyebrow reveal text-sand-300">
              <span class="h-px w-8 bg-sand-300"></span> ${parseMd(a.eyebrow, 'dark')}
            </p>
            <h2 class="reveal mt-5 font-display text-4xl font-600 sm:text-5xl"${ri(1)}>
              ${parseMd(a.headingLead, 'dark')}<br />${parseMd(a.headingRest, 'dark')}
            </h2>
            <p class="reveal mt-5 max-w-lg text-white/70"${ri(2)}>
              ${parseMd(a.body, 'dark')}
            </p>

            <div class="mt-10 grid gap-7 sm:grid-cols-2">
              ${a.features
                .map(
                  (f, i) => `<div class="reveal flex gap-4"${ri(i + 1)}>
                <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600/20 text-brand-300">
                  ${featureIcons[i] || featureIcons[0]}
                </span>
                <div>
                  <h3 class="font-display text-lg font-600">${parseMd(f.title, 'dark')}</h3>
                  <p class="mt-1.5 text-sm text-white/65">${parseMd(f.body, 'dark')}</p>
                </div>
              </div>`
                )
                .join('')}
            </div>
          </div>`
  },

  process: (c) => {
    const p = c.process
    return `<div class="mx-auto max-w-2xl text-center">
            <p class="eyebrow reveal justify-center">
              <span class="h-px w-8 bg-brand-600"></span> ${parseMd(p.eyebrow, 'eyebrow-light')}
              <span class="h-px w-8 bg-brand-600"></span>
            </p>
            <h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>
              ${parseMd(p.heading, 'light')}
            </h2>
          </div>

          <div class="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            ${p.steps
              .map(
                (st, i) => `<div class="reveal relative rounded-3xl bg-white p-8 shadow-soft ring-1 ring-ink/5"${ri(i)}>
              <span class="font-display text-5xl font-700 text-brand-100">${String(i + 1).padStart(2, '0')}</span>
              <h3 class="mt-3 font-display text-xl font-600 text-ink">${parseMd(st.title, 'light')}</h3>
              <p class="mt-3 text-sm leading-relaxed text-muted">${parseMd(st.desc, 'light')}</p>
            </div>`
              )
              .join('')}
          </div>`
  },

  gallery: (c) => {
    const g = c.gallery
    return `<div class="flex flex-wrap items-end justify-between gap-6">
            <div class="max-w-xl">
              <p class="eyebrow reveal">
                <span class="h-px w-8 bg-brand-600"></span> ${parseMd(g.eyebrow, 'eyebrow-light')}
              </p>
              <h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>
                ${parseMd(g.heading, 'light')}
              </h2>
            </div>
            <a href="#contact" class="btn-outline reveal"${ri(2)}>${parseMd(g.ctaLabel, 'light')}</a>
          </div>

          <div class="mt-14 columns-1 gap-6 sm:columns-2 lg:columns-3 [&>*]:mb-6">
            ${g.items
              .map(
                (it, i) => `<figure class="media-zoom reveal group relative overflow-hidden rounded-2xl shadow-soft"${ri(i % 3)}>
              <img src="${esc(it.image)}" alt="${esc(it.alt)}" class="w-full" loading="lazy" />
              <figcaption class="absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-ink/80 to-transparent p-5 text-sm font-500 text-white opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">${parseMd(it.caption, 'dark')}</figcaption>
            </figure>`
              )
              .join('')}
          </div>`
  },

  testimonials: (c) => {
    const t = c.testimonials
    return `<div class="mx-auto max-w-2xl text-center">
            <p class="eyebrow reveal justify-center">
              <span class="h-px w-8 bg-brand-600"></span> ${parseMd(t.eyebrow, 'eyebrow-light')}
              <span class="h-px w-8 bg-brand-600"></span>
            </p>
            <h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>
              ${parseMd(t.heading, 'light')}
            </h2>
          </div>

          <div class="mt-16 grid gap-7 lg:grid-cols-3">
            ${t.items
              .map(
                (q, i) => `<figure class="reveal rounded-3xl bg-white p-8 shadow-soft ring-1 ring-ink/5"${ri(i)}>
              <div class="flex gap-1 text-sand-400" aria-label="5 out of 5 stars">★★★★★</div>
              <blockquote class="mt-5 text-ink-700">"${parseMd(q.quote, 'light')}"</blockquote>
              <figcaption class="mt-6 text-sm font-600 text-ink">— ${parseMd(q.name, 'light')} <span class="font-400 text-muted">· ${parseMd(q.role, 'light')}</span></figcaption>
            </figure>`
              )
              .join('')}
          </div>`
  },

  ctaBand: (c) => {
    const b = c.ctaBand
    return `<div class="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-600/60"></div>
          <div class="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-sand-400/20"></div>
          <div class="relative">
            <h2 class="mx-auto max-w-2xl font-display text-4xl font-600 sm:text-5xl">${esc(b.heading)}</h2>
            <p class="mx-auto mt-5 max-w-xl text-white/75">${esc(b.subcopy)}</p>
            <div class="mt-9 flex flex-wrap justify-center gap-4">
              <a href="#contact" class="btn-gold">${esc(b.primaryLabel)}</a>
              <a href="${esc(b.callHref)}" class="btn-ghost">${esc(b.callLabel)}</a>
            </div>
          </div>`
  },

  contactInfo: (c) => {
    const k = c.contact
    const icon = (p) =>
      `<span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>`
    return `<p class="eyebrow reveal">
              <span class="h-px w-8 bg-brand-600"></span> ${esc(k.eyebrow)}
            </p>
            <h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>
              ${esc(k.heading)}
            </h2>
            <p class="reveal mt-5 max-w-md text-muted"${ri(2)}>
              ${esc(k.subcopy)}
            </p>

            <ul class="reveal mt-10 space-y-6"${ri(3)}>
              <li class="flex items-start gap-4">
                ${icon('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>')}
                <div>
                  <p class="text-xs font-600 uppercase tracking-wider text-muted">Phone</p>
                  <a href="${esc(k.phoneHref)}" class="text-lg font-600 text-ink hover:text-brand-700">${esc(k.phone)}</a>
                </div>
              </li>
              <li class="flex items-start gap-4">
                ${icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>')}
                <div>
                  <p class="text-xs font-600 uppercase tracking-wider text-muted">Email</p>
                  <a href="mailto:${esc(k.email)}" class="text-lg font-600 text-ink hover:text-brand-700">${esc(k.email)}</a>
                </div>
              </li>
              <li class="flex items-start gap-4">
                ${icon('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>')}
                <div>
                  <p class="text-xs font-600 uppercase tracking-wider text-muted">Service Area</p>
                  <p class="text-lg font-600 text-ink">${esc(k.serviceArea)}</p>
                  <p class="text-sm text-muted">${esc(k.address)}</p>
                </div>
              </li>
              <li class="flex items-start gap-4">
                ${icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}
                <div>
                  <p class="text-xs font-600 uppercase tracking-wider text-muted">Hours</p>
                  <p class="text-lg font-600 text-ink">${esc(k.hours)}</p>
                </div>
              </li>
            </ul>`
  },

  footer: (c) => {
    const f = c.footer
    const s = c.services.items
    return `<div>
          <div class="flex items-center gap-3">
            <span class="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 font-display text-lg font-700">G&amp;D</span>
            <span class="font-display text-xl font-600">G&amp;D Flooring</span>
          </div>
          <p class="mt-5 max-w-xs text-sm leading-relaxed text-white/60">${esc(f.blurb)}</p>
        </div>
        <div>
          <h3 class="text-sm font-700 uppercase tracking-wider text-white/80">Services</h3>
          <ul class="mt-5 space-y-3 text-sm text-white/60">
            ${s.map((it) => `<li><a href="#services" class="hover:text-white">${esc(it.title)}</a></li>`).join('')}
          </ul>
        </div>
        <div>
          <h3 class="text-sm font-700 uppercase tracking-wider text-white/80">Company</h3>
          <ul class="mt-5 space-y-3 text-sm text-white/60">
            <li><a href="#about" class="hover:text-white">Why Us</a></li>
            <li><a href="#process" class="hover:text-white">Our Process</a></li>
            <li><a href="#gallery" class="hover:text-white">Gallery</a></li>
            <li><a href="#contact" class="hover:text-white">Contact</a></li>
          </ul>
        </div>
        <div>
          <h3 class="text-sm font-700 uppercase tracking-wider text-white/80">Contact</h3>
          <ul class="mt-5 space-y-3 text-sm text-white/60">
            <li><a href="${esc(f.phoneHref)}" class="hover:text-white">${esc(f.phone)}</a></li>
            <li><a href="mailto:${esc(f.email)}" class="hover:text-white">${esc(f.email)}</a></li>
            <li>${esc(f.hours)}</li>
            <li>${esc(f.license)}</li>
          </ul>
        </div>`
  },
}

export default function contentInjection() {
  const file = resolve(process.cwd(), 'src/content/site.json')
  const load = () => JSON.parse(readFileSync(file, 'utf8'))
  const apply = (html) => {
    const c = load()
    // token replacements (head/meta + a couple of attrs)
    html = html.replace(/%%([\w.]+)%%/g, (m, key) => (gen[key] ? gen[key](c) : m))
    // region replacements: <!--CMS:name-->...<!--/CMS:name-->
    html = html.replace(
      /<!--CMS:([\w.]+)-->[\s\S]*?<!--\/CMS:\1-->/g,
      (m, name) => (gen[name] ? `<!--CMS:${name}-->${gen[name](c)}<!--/CMS:${name}-->` : m)
    )
    return html
  }
  return {
    name: 'gnd-content-injection',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => apply(html),
    },
  }
}
