// Single source of truth for the public site's markup.
//
// Environment-agnostic (no DOM, no node APIs) so the very same functions run:
//   • at build time   — vite-content.js injects the regions into index.html
//   • in the browser  — /draft renders a full page from any content source
//   • in the admin    — the CMS preview pane renders the page it is editing
//
// Anything visible on the site is produced here, so the three can never drift.

/* ---------- text helpers ---------- */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// A value counts as present only if it would put something on the page.
export const has = (v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '')

/* Rotating words: <Des Moines, Urbandale, Ames> puts the options in the same
   spot, taking turns. An optional "| style seconds" tail says how they change
   and how long each one stays:  <Ames, Ankeny | flip 4s>.
   The markup is inert — src/components/word-cycle.js does the cycling, and
   without it (or under reduced motion) the first option simply stands. */
const CYCLE_ANIMS = ['slide', 'fade', 'flip', 'type']

function wordCycle(body) {
  const [list, ...tail] = body.split('|')
  const opts = list
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (opts.length < 2) return null // not a list — leave the text alone

  const mod = tail.join(' ').trim().toLowerCase()
  const anim = CYCLE_ANIMS.find((a) => new RegExp(`\\b${a}\\b`).test(mod)) || 'slide'
  const secs = Number((mod.match(/(\d+(?:\.\d+)?)\s*s/) || [])[1])
  const hold = Math.round(Math.min(20, Math.max(0.6, secs || 2.6)) * 1000)

  const items = opts
    .map((o, i) => `<span class="wc-item${i ? '' : ' is-in'}"${i ? ' aria-hidden="true"' : ''}>${o}</span>`)
    .join('')
  return `<span class="wc" data-word-cycle data-anim="${anim}" data-hold="${hold}">${items}</span>`
}

// Contextual markdown. The accent colour depends on what the text sits on, so
// the same *word* reads as gold on ink, teal on sand, brand blue on cream.
export function parseMd(s, bgContext = 'light') {
  if (!has(s)) return ''
  let text = esc(s)
  let hl = 'text-brand-600 font-semibold'
  if (bgContext === 'dark') hl = 'text-sand-300 font-semibold'
  else if (bgContext === 'sand' || bgContext === 'gold') hl = 'text-teal-900 font-bold'
  else if (bgContext === 'eyebrow-light') hl = 'text-teal-700 font-bold'

  // Rotating words first, and deliberately: the markup it emits carries no
  // *, _, [ or ], so every rule below still reads the copy around it — which
  // is what lets *<Des Moines, Ames>* accent the whole rotation.
  text = text.replace(/&lt;([\s\S]*?)&gt;/g, (m, body) => wordCycle(body) || m)

  // **bold** first: the single-* rule would otherwise eat the inner asterisks
  // and leave the outer pair as literal text.
  text = text.replace(/\*\*([^*]+)\*\*/g, `<strong class="font-bold">$1</strong>`)
  text = text.replace(/\*([^*]+)\*/g, `<span class="italic ${hl}">$1</span>`)
  text = text.replace(/_([^_]+)_/g, `<em class="italic">$1</em>`)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" class="underline hover:opacity-80">$1</a>`)
  return text
}

// Emit `inner` wrapped in `open`/`close` only when there is something to show.
const when = (cond, html) => (cond ? html : '')

/* ---------- images ---------- */
// Normalises every historical shape into [{ src, alt, caption }]:
//   images: [{src, alt, caption}] | images: ["/a.jpg"] | image + alt + caption
export function imageList(item) {
  const out = []
  const push = (o) => {
    if (!o) return
    const src = typeof o === 'string' ? o : o.src || o.image
    if (!has(src)) return
    out.push({
      src,
      alt: (typeof o === 'string' ? '' : o.alt) || '',
      caption: (typeof o === 'string' ? '' : o.caption) || '',
      blur: (typeof o === 'string' ? 0 : Number(o.blur)) || 0,
    })
  }
  if (Array.isArray(item?.images)) item.images.forEach(push)
  else if (has(item?.image)) push({ src: item.image, alt: item.alt, caption: item.caption })
  return out
}

// A blurred image is almost always a backdrop: scale it up a touch so the
// softened edges never expose the box behind it.
export const blurStyle = (px) =>
  Number(px) > 0 ? ` style="filter: blur(${Number(px)}px); transform: scale(1.06);"` : ''
const blurAttr = (px) => (Number(px) > 0 ? ` data-blur="${Number(px)}"` : '')

const icons = {
  prev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  zoom: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>',
  arrow:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  svcArrow:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="transition-transform duration-300 group-hover:translate-x-1"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
}

const featureIcons = [
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 2.4 5 5.6.8-4 4 1 5.6L12 19l-5 2.4 1-5.6-4-4 5.6-.8z"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
]

const ri = (i) => (i ? ` style="--reveal-i: ${i}"` : '')

/**
 * Carousel markup. Behaviour is attached by src/components/carousel.js; the
 * whole thing is a lightbox trigger, and captions travel with each image as
 * raw markdown in data-caption so the lightbox can render them in its own
 * context. One image renders the same structure minus the chrome.
 */
export function carousel(
  imgs,
  { title = '', aspect = '4 / 3', className = '', natural = false, eager = false, group = '' } = {}
) {
  if (!imgs.length) return ''
  const single = imgs.length === 1
  const useNatural = natural && single
  const slides = imgs
    .map(
      (im, i) => `<figure class="carousel-slide"${i === 0 ? '' : ' aria-hidden="true"'}>
        <img src="${esc(im.src)}" alt="${esc(im.alt)}" data-caption="${esc(im.caption)}"${blurAttr(im.blur)}${blurStyle(im.blur)}
             ${eager && i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} draggable="false" />
      </figure>`
    )
    .join('')

  return `<div class="carousel${useNatural ? ' carousel--natural' : ''}${single ? ' carousel--single' : ''} ${className}"
       data-carousel data-lb-title="${esc(title)}"${group ? ` data-lb-group="${esc(group)}"` : ''}${useNatural ? '' : ` style="--carousel-aspect: ${aspect}"`}
       role="button" tabindex="0" aria-label="${esc(title ? title + ' — open image viewer' : 'Open image viewer')}">
    <div class="carousel-viewport"><div class="carousel-track">${slides}</div></div>
    <span class="carousel-zoom" aria-hidden="true">${icons.zoom}</span>
    ${when(
      !single,
      `<button class="carousel-nav carousel-nav--prev" type="button" data-carousel-prev aria-label="Previous image">${icons.prev}</button>
       <button class="carousel-nav carousel-nav--next" type="button" data-carousel-next aria-label="Next image">${icons.next}</button>
       <div class="carousel-dots">${imgs
         .map((_, i) => `<button class="carousel-dot${i === 0 ? ' is-active' : ''}" type="button" data-carousel-go="${i}" aria-label="Image ${i + 1}"></button>`)
         .join('')}</div>`
    )}
  </div>`
}

/* =============================================================
   Which sections have anything to say. An empty one is dropped
   from the page, and so are the nav links pointing at it.
   ============================================================= */
export const sectionPresent = {
  hero: (c) => has(c.hero?.headline) || has(c.hero?.headlineLead) || has(c.hero?.subcopy) || has(c.hero?.image),
  trust: (c) => (c.trust || []).some(has),
  services: (c) => has(c.services?.heading) || (c.services?.items || []).length > 0,
  about: (c) => has(c.about?.headingLead) || has(c.about?.headingRest) || has(c.about?.body) || has(c.about?.image),
  process: (c) => has(c.process?.heading) || (c.process?.steps || []).length > 0,
  gallery: (c) => has(c.gallery?.heading) || (c.gallery?.items || []).length > 0,
  testimonials: (c) => has(c.testimonials?.heading) || (c.testimonials?.items || []).length > 0,
  ctaBand: (c) => has(c.ctaBand?.heading) || has(c.ctaBand?.subcopy),
  contact: (c) => has(c.contact?.heading) || has(c.contact?.phone) || has(c.contact?.email),
  commercial: (c) => has(c.commercial?.heading) || (c.commercial?.items || []).length > 0,
}

// `href` marks a link to another page; the rest are anchors on the home page.
const NAV = [
  { id: 'services', label: 'Services' },
  { id: 'about', label: 'Why Us' },
  { id: 'process', label: 'Process' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'commercial', label: 'Commercial', href: '/commercial/' },
  { id: 'contact', label: 'Contact' },
]
const navItems = (c) => NAV.filter((n) => sectionPresent[n.id](c))
// `base` is '' on the home page and '/' on any other, so anchors keep working
// once the link has to travel back to the home document.
const navHref = (n, base = '') => n.href || `${base}#${n.id}`
const hasContact = (c) => sectionPresent.contact(c)
// Buttons that scroll to #contact are pointless once contact is gone.
const contactCta = (c, html) => (hasContact(c) ? html : '')

/* =============================================================
   Sections — each returns a complete <section>, or '' when empty
   ============================================================= */
export const gen = {
  'meta.title': (c) => esc(c.meta?.title),
  'meta.description': (c) => esc(c.meta?.description),
  'meta.ogTitle': (c) => esc(c.meta?.ogTitle),
  'meta.ogDescription': (c) => esc(c.meta?.ogDescription),

  nav: (c, base = '') =>
    navItems(c)
      .map((n) => `<a href="${navHref(n, base)}" class="nav-link text-sm font-500">${n.label}</a>`)
      .join('\n          '),

  navCta: (c, base = '') =>
    contactCta(
      c,
      `<a href="${base}#contact" class="btn-gold hidden lg:inline-flex">${parseMd(c.hero?.ctaPrimary || 'Get a Free Quote', 'gold')}</a>`
    ),

  mobileNav: (c, base = '') =>
    navItems(c)
      .map(
        (n) =>
          `<a href="${navHref(n, base)}" class="rounded-xl px-4 py-3 text-base font-500 text-ink-700 hover:bg-brand-50">${n.label}</a>`
      )
      .join('\n          ') +
    contactCta(c, `\n          <a href="${base}#contact" class="btn-gold mt-3 w-full">${parseMd(c.hero?.ctaPrimary || 'Get a Free Quote', 'gold')}</a>`),

  sectionHero: (c) => {
    const h = c.hero || {}
    if (!sectionPresent.hero(c)) return ''
    const headline = h.headline || `${h.headlineLead || ''} *${h.highlight || ''}* ${h.headlineRest || ''}`.trim()
    const stats = (h.stats || []).filter((s) => has(s.value) || has(s.label))
    return `<section id="home" class="relative flex min-h-screen items-center overflow-hidden">
      ${when(
        has(h.image),
        `<div class="hero-bg absolute inset-0 -z-10 scale-110">
        <img src="${esc(h.image)}" alt="" class="h-full w-full object-cover" fetchpriority="high"${blurStyle(h.imageBlur)} />
        <div class="absolute inset-0 bg-gradient-to-br from-ink/80 via-brand-800/70 to-brand-700/55"></div>
        <div class="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent"></div>
      </div>`
      )}
      <div class="container-x py-32">
        <div class="max-w-3xl">
          ${when(
            has(h.eyebrow),
            `<p class="eyebrow reveal text-sand-300"><span class="h-px w-8 bg-sand-300"></span> ${parseMd(h.eyebrow, 'dark')}</p>`
          )}
          ${when(
            has(headline),
            `<h1 class="reveal mt-6 font-display text-5xl font-600 leading-[1.05] text-white sm:text-6xl lg:text-7xl"${ri(1)}>${parseMd(headline, 'dark')}</h1>`
          )}
          ${when(
            has(h.subcopy),
            `<p class="reveal mt-7 max-w-xl text-lg leading-relaxed text-white/80"${ri(2)}>${parseMd(h.subcopy, 'dark')}</p>`
          )}
          ${when(
            has(h.ctaPrimary) || has(h.ctaSecondary) || sectionPresent.commercial(c),
            `<div class="reveal mt-10 flex flex-wrap items-center gap-4"${ri(3)}>
            ${contactCta(c, when(has(h.ctaPrimary), `<a href="#contact" class="btn-gold">${parseMd(h.ctaPrimary, 'gold')}</a>`))}
            ${when(
              has(h.ctaSecondary) && sectionPresent.services(c),
              `<a href="#services" class="btn-ghost">${parseMd(h.ctaSecondary, 'dark')} ${icons.arrow}</a>`
            )}
            ${when(
              sectionPresent.commercial(c),
              `<a href="/commercial/" class="btn-ghost">${parseMd(c.commercial?.ctaLabel || 'Commercial Services', 'dark')} ${icons.arrow}</a>`
            )}
          </div>`
          )}
          ${when(
            stats.length > 0,
            `<dl class="reveal mt-16 flex flex-wrap gap-8 border-t border-white/15 pt-8"${ri(4)}>
            ${stats
              .map(
                (s) =>
                  `<div><dt class="text-sm text-white/60">${parseMd(s.label, 'dark')}:</dt><dd class="font-display text-3xl font-600 text-white mt-1">${parseMd(s.value, 'dark')}</dd></div>`
              )
              .join('')}
          </dl>`
          )}
        </div>
      </div>
      ${when(
        sectionPresent.services(c),
        `<a href="#services" class="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-white/60 md:flex" aria-label="Scroll to services">
        <span class="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
        <span class="relative grid h-9 w-5 place-items-start justify-center rounded-full border border-white/40 pt-1.5">
          <span class="h-1.5 w-1 rounded-full bg-white/70 animate-float-soft"></span>
        </span>
      </a>`
      )}
    </section>`
  },

  sectionTrust: (c) => {
    if (!sectionPresent.trust(c)) return ''
    const sep = '<span class="hidden h-4 w-px bg-ink/15 sm:block"></span>'
    return `<section class="border-y border-ink/5 bg-cream-200/60">
      <div class="container-x flex flex-wrap items-center justify-center gap-x-12 gap-y-4 py-6 text-center text-sm font-500 text-muted">
        ${(c.trust || [])
          .filter(has)
          .map((t, i) => `<span class="reveal"${ri(i)}>${parseMd(t, 'sand')}</span>`)
          .join(sep)}
      </div>
    </section>`
  },

  sectionServices: (c) => {
    if (!sectionPresent.services(c)) return ''
    const s = c.services || {}
    const items = s.items || []
    return `<section id="services" class="py-24 lg:py-32">
      <div class="container-x">
        <div class="mx-auto max-w-2xl text-center">
          ${when(
            has(s.eyebrow),
            `<p class="eyebrow reveal justify-center"><span class="h-px w-8 bg-brand-600"></span> ${parseMd(s.eyebrow, 'eyebrow-light')} <span class="h-px w-8 bg-brand-600"></span></p>`
          )}
          ${when(
            has(s.heading),
            `<h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>${parseMd(s.heading, 'light')}</h2>`
          )}
          ${when(has(s.subcopy), `<p class="reveal mt-5 text-lg text-muted"${ri(2)}>${parseMd(s.subcopy, 'light')}</p>`)}
        </div>
        ${when(
          items.length > 0,
          `<div class="mt-16 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
          ${items
            .map((it, i) => {
              const imgs = imageList(it)
              const bullets = (it.bullets || []).filter(has)
              return `<article class="card-lift reveal group overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-ink/5"${ri(i)}>
              ${carousel(imgs, { title: it.title || 'Service', aspect: '4 / 3' })}
              <div class="p-7">
                ${when(has(it.title), `<h3 class="font-display text-xl font-600 text-ink">${parseMd(it.title, 'light')}</h3>`)}
                ${when(has(it.desc), `<p class="mt-3 text-sm leading-relaxed text-muted">${parseMd(it.desc, 'light')}</p>`)}
                ${when(
                  bullets.length > 0,
                  `<ul class="mt-5 space-y-2 text-sm text-ink-700">${bullets
                    .map((b) => `<li class="flex items-center gap-2"><span class="text-brand-600">✓</span> ${parseMd(b, 'light')}</li>`)
                    .join('')}</ul>`
                )}
                ${contactCta(
                  c,
                  `<a href="#contact" class="mt-6 inline-flex items-center gap-1.5 text-sm font-600 text-brand-700">Request this service ${icons.svcArrow}</a>`
                )}
              </div>
            </article>`
            })
            .join('')}
        </div>`
        )}
      </div>
    </section>`
  },

  sectionAbout: (c) => {
    if (!sectionPresent.about(c)) return ''
    const a = c.about || {}
    const features = (a.features || []).filter((f) => has(f.title) || has(f.body))
    return `<section id="about" class="bg-ink py-24 text-white lg:py-32">
      <div class="container-x grid items-center gap-14 lg:grid-cols-2">
        ${when(
          has(a.image),
          `<div class="reveal relative">
          <div class="media-zoom overflow-hidden rounded-[2rem] shadow-lift">
            <img src="${esc(a.image)}" alt="${esc(a.alt)}" class="aspect-[4/5] w-full object-cover" loading="lazy"${blurStyle(a.imageBlur)} />
          </div>
          ${when(
            has(a.badgeValue) || has(a.badgeLabel),
            `<div class="absolute -bottom-7 -right-3 hidden rounded-2xl bg-sand-400 p-6 text-ink shadow-lift sm:block lg:-right-7">
            ${when(has(a.badgeValue), `<p class="font-display text-3xl font-700">${parseMd(a.badgeValue, 'sand')}</p>`)}
            ${when(has(a.badgeLabel), `<p class="text-xs font-600 uppercase tracking-wider">${parseMd(a.badgeLabel, 'sand')}</p>`)}
          </div>`
          )}
        </div>`
        )}
        <div>
          ${when(
            has(a.eyebrow),
            `<p class="eyebrow reveal text-sand-300"><span class="h-px w-8 bg-sand-300"></span> ${parseMd(a.eyebrow, 'dark')}</p>`
          )}
          ${when(
            has(a.headingLead) || has(a.headingRest),
            `<h2 class="reveal mt-5 font-display text-4xl font-600 sm:text-5xl"${ri(1)}>${parseMd(a.headingLead, 'dark')}${when(
              has(a.headingLead) && has(a.headingRest),
              '<br />'
            )}${parseMd(a.headingRest, 'dark')}</h2>`
          )}
          ${when(has(a.body), `<p class="reveal mt-5 max-w-lg text-white/70"${ri(2)}>${parseMd(a.body, 'dark')}</p>`)}
          ${when(
            features.length > 0,
            `<div class="mt-10 grid gap-7 sm:grid-cols-2">
            ${features
              .map(
                (f, i) => `<div class="reveal flex gap-4"${ri(i + 1)}>
              <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600/20 text-brand-300">${featureIcons[i % featureIcons.length]}</span>
              <div>
                ${when(has(f.title), `<h3 class="font-display text-lg font-600">${parseMd(f.title, 'dark')}</h3>`)}
                ${when(has(f.body), `<p class="mt-1.5 text-sm text-white/65">${parseMd(f.body, 'dark')}</p>`)}
              </div>
            </div>`
              )
              .join('')}
          </div>`
          )}
        </div>
      </div>
    </section>`
  },

  sectionProcess: (c) => {
    if (!sectionPresent.process(c)) return ''
    const p = c.process || {}
    const steps = p.steps || []
    return `<section id="process" class="py-24 lg:py-32">
      <div class="container-x">
        <div class="mx-auto max-w-2xl text-center">
          ${when(
            has(p.eyebrow),
            `<p class="eyebrow reveal justify-center"><span class="h-px w-8 bg-brand-600"></span> ${parseMd(p.eyebrow, 'eyebrow-light')} <span class="h-px w-8 bg-brand-600"></span></p>`
          )}
          ${when(
            has(p.heading),
            `<h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>${parseMd(p.heading, 'light')}</h2>`
          )}
        </div>
        ${when(
          steps.length > 0,
          `<div class="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          ${steps
            .map(
              (st, i) => `<div class="step-card reveal relative overflow-hidden rounded-3xl bg-white p-8 shadow-soft ring-1 ring-ink/5"${ri(i)}>
            ${when(
              has(st.image),
              `<div class="step-card-bg" aria-hidden="true"><img src="${esc(st.image)}" alt="${esc(st.alt)}" loading="lazy"${blurStyle(st.imageBlur)} /></div>`
            )}
            <div class="relative">
              <span class="font-display text-5xl font-700 ${has(st.image) ? 'text-white/90 drop-shadow' : 'text-brand-100'}">${String(i + 1).padStart(2, '0')}</span>
              ${when(has(st.title), `<h3 class="mt-3 font-display text-xl font-600 text-ink">${parseMd(st.title, 'light')}</h3>`)}
              ${when(has(st.desc), `<p class="mt-3 text-sm leading-relaxed text-muted">${parseMd(st.desc, 'light')}</p>`)}
            </div>
          </div>`
            )
            .join('')}
        </div>`
        )}
      </div>
    </section>`
  },

  sectionGallery: (c) => {
    if (!sectionPresent.gallery(c)) return ''
    const g = c.gallery || {}
    const items = (g.items || []).filter((it) => imageList(it).length > 0)
    return `<section id="gallery" class="bg-cream-200/50 py-24 lg:py-32">
      <div class="container-x">
        <div class="flex flex-wrap items-end justify-between gap-6">
          <div class="max-w-xl">
            ${when(
              has(g.eyebrow),
              `<p class="eyebrow reveal"><span class="h-px w-8 bg-brand-600"></span> ${parseMd(g.eyebrow, 'eyebrow-light')}</p>`
            )}
            ${when(
              has(g.heading),
              `<h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>${parseMd(g.heading, 'light')}</h2>`
            )}
          </div>
          ${contactCta(c, when(has(g.ctaLabel), `<a href="#contact" class="btn-outline reveal"${ri(2)}>${parseMd(g.ctaLabel, 'light')}</a>`))}
        </div>
        ${when(
          items.length > 0,
          `<div class="mt-14 columns-1 gap-6 sm:columns-2 lg:columns-3 [&>*]:mb-6">
          ${items
            .map((it, i) => {
              const imgs = imageList(it)
              const cap = imgs[0]?.caption || it.caption
              const projectTitle = has(cap) ? String(cap).replace(/[*_]/g, '') : `Project ${i + 1}`
              return `<figure class="reveal group relative overflow-hidden rounded-2xl shadow-soft"${ri(i % 3)}>
              ${carousel(imgs, { title: projectTitle, natural: true, className: 'carousel--flush', group: 'gallery' })}
              ${when(
                has(cap),
                `<figcaption class="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-ink/80 to-transparent p-5 text-sm font-500 text-white opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">${parseMd(cap, 'dark')}</figcaption>`
              )}
            </figure>`
            })
            .join('')}
        </div>`
        )}
      </div>
    </section>`
  },

  sectionTestimonials: (c) => {
    if (!sectionPresent.testimonials(c)) return ''
    const t = c.testimonials || {}
    const items = (t.items || []).filter((q) => has(q.quote) || has(q.name))
    return `<section class="py-24 lg:py-32">
      <div class="container-x">
        <div class="mx-auto max-w-2xl text-center">
          ${when(
            has(t.eyebrow),
            `<p class="eyebrow reveal justify-center"><span class="h-px w-8 bg-brand-600"></span> ${parseMd(t.eyebrow, 'eyebrow-light')} <span class="h-px w-8 bg-brand-600"></span></p>`
          )}
          ${when(
            has(t.heading),
            `<h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>${parseMd(t.heading, 'light')}</h2>`
          )}
        </div>
        ${when(
          items.length > 0,
          `<div class="mt-16 grid gap-7 lg:grid-cols-3">
          ${items
            .map((q, i) => {
              const imgs = imageList(q)
              return `<figure class="reveal flex gap-5 rounded-3xl bg-white p-7 shadow-soft ring-1 ring-ink/5"${ri(i)}>
              ${when(
                imgs.length > 0,
                `<div class="w-2/5 shrink-0">${carousel(imgs, { title: q.name || 'Testimonial', aspect: '1 / 1', className: 'carousel--rounded' })}</div>`
              )}
              <div class="min-w-0">
                ${when(has(q.quote), `<blockquote class="text-ink-700">"${parseMd(q.quote, 'light')}"</blockquote>`)}
                ${when(
                  has(q.name) || has(q.role),
                  `<figcaption class="mt-5 text-sm font-600 text-ink">— ${parseMd(q.name, 'light')}${when(
                    has(q.role),
                    ` <span class="font-400 text-muted">· ${parseMd(q.role, 'light')}</span>`
                  )}</figcaption>`
                )}
              </div>
            </figure>`
            })
            .join('')}
        </div>`
        )}
      </div>
    </section>`
  },

  sectionCtaBand: (c) => {
    if (!sectionPresent.ctaBand(c)) return ''
    const b = c.ctaBand || {}
    return `<section class="container-x">
      <div class="reveal relative overflow-hidden rounded-[2.5rem] bg-brand-700 px-8 py-16 text-center text-white shadow-lift sm:px-16 sm:py-20">
        <div class="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-600/60"></div>
        <div class="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-sand-400/20"></div>
        <div class="relative">
          ${when(
            has(b.heading),
            `<h2 class="mx-auto max-w-2xl font-display text-4xl font-600 sm:text-5xl">${parseMd(b.heading, 'dark')}</h2>`
          )}
          ${when(has(b.subcopy), `<p class="mx-auto mt-5 max-w-xl text-white/75">${parseMd(b.subcopy, 'dark')}</p>`)}
          ${when(
            has(b.primaryLabel) || has(b.callLabel),
            `<div class="mt-9 flex flex-wrap justify-center gap-4">
            ${contactCta(c, when(has(b.primaryLabel), `<a href="#contact" class="btn-gold">${parseMd(b.primaryLabel, 'gold')}</a>`))}
            ${when(has(b.callLabel), `<a href="${esc(b.callHref)}" class="btn-ghost">${parseMd(b.callLabel, 'dark')}</a>`)}
          </div>`
          )}
        </div>
      </div>
    </section>`
  },

  sectionContact: (c, opts = {}) => {
    if (!sectionPresent.contact(c)) return ''
    const k = c.contact || {}
    const icon = (p) =>
      `<span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>`
    const row = (iconPath, label, body) =>
      `<li class="flex items-start gap-4">${icon(iconPath)}<div><p class="text-xs font-600 uppercase tracking-wider text-muted">${label}</p>${body}</div></li>`

    const rows = [
      when(
        has(k.phone),
        row(
          '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
          'Phone',
          `<a href="${esc(k.phoneHref)}" class="text-lg font-600 text-ink hover:text-brand-700">${parseMd(k.phone, 'light')}</a>`
        )
      ),
      when(
        has(k.email),
        row(
          '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
          'Email',
          `<a href="mailto:${esc(k.email)}" class="text-lg font-600 text-ink hover:text-brand-700">${parseMd(k.email, 'light')}</a>`
        )
      ),
      when(
        has(k.serviceArea) || has(addressLine(k)),
        row(
          '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
          'Service Area',
          `${when(has(k.serviceArea), `<p class="text-lg font-600 text-ink">${parseMd(k.serviceArea, 'light')}</p>`)}${when(
            has(addressLine(k)),
            `<p class="text-sm text-muted">${esc(addressLine(k))}</p>`
          )}`
        )
      ),
      when(
        has(k.hours),
        row('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'Hours', `<p class="text-lg font-600 text-ink">${parseMd(k.hours, 'light')}</p>`)
      ),
    ].join('')

    return `<section id="contact" class="py-24 lg:py-32">
      <div class="container-x grid gap-14 lg:grid-cols-2">
        <div>
          ${when(
            has(k.eyebrow),
            `<p class="eyebrow reveal"><span class="h-px w-8 bg-brand-600"></span> ${parseMd(k.eyebrow, 'eyebrow-light')}</p>`
          )}
          ${when(
            has(k.heading),
            `<h2 class="reveal mt-5 font-display text-4xl font-600 text-ink sm:text-5xl"${ri(1)}>${parseMd(k.heading, 'light')}</h2>`
          )}
          ${when(has(k.subcopy), `<p class="reveal mt-5 max-w-md text-muted"${ri(2)}>${parseMd(k.subcopy, 'light')}</p>`)}
          ${when(has(rows), `<ul class="reveal mt-10 space-y-6"${ri(3)}>${rows}</ul>`)}
        </div>
        <div class="reveal" style="--reveal-i: 1">${quoteForm(c, opts)}</div>
      </div>
    </section>`
  },

  footer: (c) => {
    const f = c.footer || {}
    const mark = brandMark(c, 'h-11 w-11')
    const services = (c.services?.items || []).filter((it) => has(it.title))
    const company = navItems(c).filter((n) => n.id !== 'services')
    const base = c.__base || ''
    // Phone, email and hours live once, in `contact`.
    const k = c.contact || {}
    const contactLines = [
      when(has(k.phone), `<li><a href="${esc(k.phoneHref)}" class="hover:text-white">${parseMd(k.phone, 'dark')}</a></li>`),
      when(has(k.email), `<li><a href="mailto:${esc(k.email)}" class="hover:text-white">${parseMd(k.email, 'dark')}</a></li>`),
      when(has(k.hours), `<li>${parseMd(k.hours, 'dark')}</li>`),
      when(has(f.license), `<li>${parseMd(f.license, 'dark')}</li>`),
    ].join('')
    return `<div>
        <div class="flex items-center gap-3">
          ${mark}
          <span class="font-display text-xl font-600">${esc(brandName(c))}</span>
        </div>
        ${when(has(f.blurb), `<p class="mt-5 max-w-xs text-sm leading-relaxed text-white/60">${parseMd(f.blurb, 'dark')}</p>`)}
      </div>
      ${when(
        services.length > 0 && sectionPresent.services(c),
        `<div>
        <h3 class="text-sm font-700 uppercase tracking-wider text-white/80">Services</h3>
        <ul class="mt-5 space-y-3 text-sm text-white/60">
          ${services.map((it) => `<li><a href="${base}#services" class="hover:text-white">${parseMd(it.title, 'dark')}</a></li>`).join('')}
        </ul>
      </div>`
      )}
      ${when(
        company.length > 0,
        `<div>
        <h3 class="text-sm font-700 uppercase tracking-wider text-white/80">Company</h3>
        <ul class="mt-5 space-y-3 text-sm text-white/60">
          ${company.map((n) => `<li><a href="${navHref(n, base)}" class="hover:text-white">${n.label}</a></li>`).join('')}
        </ul>
      </div>`
      )}
      ${when(
        has(contactLines),
        `<div>
        <h3 class="text-sm font-700 uppercase tracking-wider text-white/80">Contact</h3>
        <ul class="mt-5 space-y-3 text-sm text-white/60">${contactLines}</ul>
      </div>`
      )}`
  },

  footerNote: (c) => when(has(c.footer?.note), `<p>${parseMd(c.footer.note, 'dark')}</p>`),

  // Whole-block regions used by index.html
  header: (c) => headerHtml(c),
  footerBlock: (c) => footerHtml(c),
  headMeta: (c) => headMeta(c, { path: '/' }),
}

/* ---------- contact, structured data and head tags ---------- */
export const SITE_URL = 'https://www.gnd-flooring.com'

/** One-line postal address from its parts; empty when nothing is set. */
export function addressLine(k = {}) {
  return [k.addressStreet, k.addressLocality, [k.addressRegion, k.addressPostal].filter(has).join(' ')]
    .filter(has)
    .join(', ')
}

/**
 * schema.org business record, built from `contact` so it can never drift
 * from what the page says. Fields with no value are omitted rather than
 * published empty — a wrong phone number is worse than no phone number.
 */
export function jsonLd(c) {
  const k = c.contact || {}
  const url = c.brand?.url || SITE_URL
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HomeAndConstructionBusiness',
    name: brandName(c),
    url,
    ...(has(c.brand?.logo) ? { logo: url + c.brand.logo, image: url + c.brand.logo } : {}),
    ...(has(c.meta?.description) ? { description: c.meta.description } : {}),
    ...(has(k.phone) ? { telephone: k.phoneHref ? k.phoneHref.replace(/^tel:/, '') : k.phone } : {}),
    ...(has(k.email) ? { email: k.email } : {}),
    ...(has(k.priceRange) ? { priceRange: k.priceRange } : {}),
  }

  const addr = {
    ...(has(k.addressStreet) ? { streetAddress: k.addressStreet } : {}),
    ...(has(k.addressLocality) ? { addressLocality: k.addressLocality } : {}),
    ...(has(k.addressRegion) ? { addressRegion: k.addressRegion } : {}),
    ...(has(k.addressPostal) ? { postalCode: k.addressPostal } : {}),
    ...(has(k.addressCountry) ? { addressCountry: k.addressCountry } : {}),
  }
  if (Object.keys(addr).length) data.address = { '@type': 'PostalAddress', ...addr }

  const areas = (k.areaServed || []).filter(has)
  if (areas.length) data.areaServed = areas.map((a) => ({ '@type': 'Place', name: a }))

  const hours = (k.openingHours || []).filter(has)
  if (hours.length) data.openingHours = hours

  const sameAs = (k.sameAs || []).filter(has)
  if (sameAs.length) data.sameAs = sameAs

  const services = (c.services?.items || []).filter((it) => has(it.title))
  if (services.length)
    data.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Flooring services',
      itemListElement: services.map((it) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: String(it.title).replace(/[*_]/g, '') },
      })),
    }

  return `<script type="application/ld+json">${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}</script>`
}

/** description + canonical + Open Graph + Twitter, per page. */
export function headMeta(c, { path = '/', title, description } = {}) {
  const url = (c.brand?.url || SITE_URL) + path
  const t = title || c.meta?.ogTitle || c.meta?.title || brandName(c)
  const d = description || c.meta?.ogDescription || c.meta?.description || ''
  const img = has(c.hero?.image) ? (c.brand?.url || SITE_URL) + c.hero.image : ''
  return `<meta name="description" content="${esc(d)}" />
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${esc(brandName(c))}" />
    <meta property="og:title" content="${esc(t)}" />
    <meta property="og:description" content="${esc(d)}" />
    <meta property="og:url" content="${esc(url)}" />
    ${img ? `<meta property="og:image" content="${esc(img)}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(t)}" />
    <meta name="twitter:description" content="${esc(d)}" />
    ${img ? `<meta name="twitter:image" content="${esc(img)}" />` : ''}
    ${jsonLd(c)}`
}

/* ---------- brand ---------- */
export const brandName = (c) => c.brand?.name || 'G&D Flooring'
// An uploaded logo (SVG or bitmap) replaces the built-in monogram tile.
export function brandMark(c, size = 'h-11 w-11') {
  const logo = c.brand?.logo
  return has(logo)
    ? `<img src="${esc(logo)}" alt="${esc(brandName(c))}" class="${size} shrink-0 rounded-xl object-contain" />`
    : `<span class="grid ${size} shrink-0 place-items-center rounded-xl bg-brand-600 font-display text-lg font-700 text-white shadow-soft">G&amp;D</span>`
}

/* ---------- quote form (static markup, content-independent) ---------- */
function quoteForm(c, { inert = false } = {}) {
  const services = (c.services?.items || []).filter((it) => has(it.title))
  const options = services.length
    ? services.map((it) => `<option>${esc(String(it.title).replace(/\*/g, ''))}</option>`).join('') + '<option>Not sure yet</option>'
    : '<option>Not sure yet</option>'
  const fieldCls =
    'mt-2 w-full rounded-xl border border-ink/10 bg-cream/50 px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200'
  return `<form id="quoteForm" class="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-ink/5 sm:p-10" novalidate${inert ? ' data-inert="true"' : ''}>
      <div class="grid gap-5 sm:grid-cols-2">
        <label class="block"><span class="text-sm font-600 text-ink">Full name</span>
          <input type="text" name="name" required class="${fieldCls}" placeholder="Jane Doe" /></label>
        <label class="block"><span class="text-sm font-600 text-ink">Phone</span>
          <input type="tel" name="phone" class="${fieldCls}" placeholder="(555) 000-0000" /></label>
      </div>
      <label class="mt-5 block"><span class="text-sm font-600 text-ink">Email</span>
        <input type="email" name="email" required class="${fieldCls}" placeholder="jane@example.com" /></label>
      <label class="mt-5 block"><span class="text-sm font-600 text-ink">Service of interest</span>
        <select name="service" class="${fieldCls}">${options}</select></label>
      <label class="mt-5 block"><span class="text-sm font-600 text-ink">Project details</span>
        <textarea name="message" rows="4" class="${fieldCls}" placeholder="Tell us about the space, square footage, timeline…"></textarea></label>
      <button type="submit" id="quoteSubmit" class="btn-primary mt-7 w-full">Request My Free Quote</button>
      <p id="quoteStatus" role="status" aria-live="polite" class="mt-4 text-center text-sm font-500 empty:hidden"></p>
      <p class="mt-4 text-center text-xs text-muted">
        Protected by reCAPTCHA — the Google
        <a href="https://policies.google.com/privacy" class="underline hover:text-ink" target="_blank" rel="noopener">Privacy Policy</a>
        and
        <a href="https://policies.google.com/terms" class="underline hover:text-ink" target="_blank" rel="noopener">Terms of Service</a>
        apply.
      </p>
    </form>`
}

/* =============================================================
   Whole page — header + main + footer.
   Used by /draft and by the CMS preview pane; the built index.html
   injects the same pieces through the regions above.
   ============================================================= */
export function renderPage(c, opts = {}) {
  return `${headerHtml(c)}
    <main id="main">
      ${gen.sectionHero(c)}
      ${gen.sectionTrust(c)}
      ${gen.sectionServices(c)}
      ${gen.sectionAbout(c)}
      ${gen.sectionProcess(c)}
      ${gen.sectionGallery(c)}
      ${gen.sectionTestimonials(c)}
      ${gen.sectionCtaBand(c)}
      ${gen.sectionContact(c, opts)}
    </main>
    ${footerHtml(c)}`
}

export function headerHtml(c, base = '') {
  return `<header class="site-header fixed inset-x-0 top-0 z-50 py-5">
      <div class="container-x flex items-center justify-between">
        <a href="${base || '#home'}" class="brand-mark flex items-center gap-3 text-white">
          ${brandMark(c, 'h-11 w-11')}
          <span class="font-display text-xl font-600 tracking-tight">${esc(brandName(c))}</span>
        </a>
        <nav class="hidden items-center gap-9 lg:flex" aria-label="Primary">
          ${gen.nav(c, base)}
        </nav>
        ${gen.navCta(c, base)}
        <button id="menuToggle" class="grid h-11 w-11 place-items-center rounded-xl border border-white/30 text-white lg:hidden" aria-label="Open menu" aria-expanded="false" aria-controls="mobileMenu">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
      </div>
      <div id="mobileMenu" class="mobile-menu absolute inset-x-4 top-[calc(100%+0.5rem)] rounded-2xl bg-cream p-6 shadow-lift lg:hidden" data-open="false">
        <nav class="flex flex-col gap-1" aria-label="Mobile">
          ${gen.mobileNav(c, base)}
        </nav>
      </div>
    </header>`
}

export function footerHtml(c, base = '') {
  c = base ? { ...c, __base: base } : c
  return `<footer class="bg-ink text-white">
      <div class="container-x grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        ${gen.footer(c)}
      </div>
      <div class="border-t border-white/10">
        <div class="container-x flex flex-col items-center justify-between gap-3 py-6 text-xs text-white/50 sm:flex-row">
          <p>© <span id="year">${new Date().getFullYear()}</span> ${esc(brandName(c))}. All rights reserved.</p>
          ${gen.footerNote(c)}
        </div>
      </div>
    </footer>`
}

/* =============================================================
   Commercial services — a page of its own, linked from the hero
   and the nav. Same components as the home page so it inherits
   the carousels, lightbox and markdown rules for free.
   ============================================================= */
export const gen2 = {
  'commercial.meta.title': (c) => esc(c.commercial?.metaTitle || `Commercial Services — ${brandName(c)}`),
  'commercial.meta.description': (c) => esc(c.commercial?.metaDescription || c.commercial?.subcopy || ''),
  commercialPage: (c) => renderCommercialPage(c),
  headMetaCommercial: (c) =>
    headMeta(c, {
      path: '/commercial/',
      title: c.commercial?.metaTitle || `Commercial Services — ${brandName(c)}`,
      description: c.commercial?.metaDescription || c.commercial?.subcopy || '',
    }),
}
Object.assign(gen, gen2)

export function renderCommercialPage(c, opts = {}) {
  const m = c.commercial || {}
  const items = (m.items || []).filter((it) => has(it.title) || imageList(it).length)
  const sectors = (m.sectors || []).filter(has)

  return `${headerHtml(c, '/')}
    <main id="main">
      <section id="commercial" class="relative flex min-h-[70vh] items-center overflow-hidden">
        ${when(
          has(m.image),
          `<div class="hero-bg absolute inset-0 -z-10 scale-110">
          <img src="${esc(m.image)}" alt="" class="h-full w-full object-cover" fetchpriority="high"${blurStyle(m.imageBlur)} />
          <div class="absolute inset-0 bg-gradient-to-br from-ink/85 via-brand-800/75 to-brand-700/60"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent"></div>
        </div>`
        )}
        ${when(!has(m.image), '<div class="absolute inset-0 -z-10 bg-ink"></div>')}
        <div class="container-x py-28">
          <div class="max-w-3xl">
            ${when(
              has(m.eyebrow),
              `<p class="eyebrow reveal text-sand-300"><span class="h-px w-8 bg-sand-300"></span> ${parseMd(m.eyebrow, 'dark')}</p>`
            )}
            ${when(
              has(m.heading),
              `<h1 class="reveal mt-6 font-display text-4xl font-600 leading-[1.08] text-white sm:text-5xl lg:text-6xl"${ri(1)}>${parseMd(m.heading, 'dark')}</h1>`
            )}
            ${when(
              has(m.subcopy),
              `<p class="reveal mt-7 max-w-xl text-lg leading-relaxed text-white/80"${ri(2)}>${parseMd(m.subcopy, 'dark')}</p>`
            )}
            <div class="reveal mt-10 flex flex-wrap items-center gap-4"${ri(3)}>
              ${contactCta(
                c,
                `<a href="/#contact" class="btn-gold">${parseMd(m.ctaPrimary || c.hero?.ctaPrimary || 'Get a Free Quote', 'gold')}</a>`
              )}
              <a href="/" class="btn-ghost">${parseMd(m.backLabel || 'Residential services', 'dark')} ${icons.arrow}</a>
            </div>
          </div>
        </div>
      </section>

      ${when(
        has(m.intro) || items.length > 0,
        `<section class="py-24 lg:py-32">
        <div class="container-x">
          ${when(
            has(m.introHeading) || has(m.intro),
            `<div class="mx-auto max-w-2xl text-center">
            ${when(
              has(m.introHeading),
              `<h2 class="reveal font-display text-4xl font-600 text-ink sm:text-5xl">${parseMd(m.introHeading, 'light')}</h2>`
            )}
            ${when(has(m.intro), `<p class="reveal mt-5 text-lg text-muted"${ri(1)}>${parseMd(m.intro, 'light')}</p>`)}
          </div>`
          )}
          ${when(
            items.length > 0,
            `<div class="mt-16 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            ${items
              .map((it, i) => {
                const imgs = imageList(it)
                const bullets = (it.bullets || []).filter(has)
                return `<article class="card-lift reveal group overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-ink/5"${ri(i)}>
                ${carousel(imgs, { title: it.title || 'Commercial', aspect: '4 / 3' })}
                <div class="p-7">
                  ${when(has(it.title), `<h3 class="font-display text-xl font-600 text-ink">${parseMd(it.title, 'light')}</h3>`)}
                  ${when(has(it.desc), `<p class="mt-3 text-sm leading-relaxed text-muted">${parseMd(it.desc, 'light')}</p>`)}
                  ${when(
                    bullets.length > 0,
                    `<ul class="mt-5 space-y-2 text-sm text-ink-700">${bullets
                      .map((b) => `<li class="flex items-center gap-2"><span class="text-brand-600">✓</span> ${parseMd(b, 'light')}</li>`)
                      .join('')}</ul>`
                  )}
                  ${contactCta(
                    c,
                    `<a href="/#contact" class="mt-6 inline-flex items-center gap-1.5 text-sm font-600 text-brand-700">Request a quote ${icons.svcArrow}</a>`
                  )}
                </div>
              </article>`
              })
              .join('')}
          </div>`
          )}
        </div>
      </section>`
      )}

      ${when(
        sectors.length > 0,
        `<section class="bg-cream-200/50 py-20">
        <div class="container-x">
          ${when(
            has(m.sectorsHeading),
            `<h2 class="reveal mx-auto max-w-2xl text-center font-display text-3xl font-600 text-ink sm:text-4xl">${parseMd(m.sectorsHeading, 'light')}</h2>`
          )}
          <div class="mt-12 flex flex-wrap items-center justify-center gap-3">
            ${sectors
              .map(
                (t, i) =>
                  `<span class="reveal rounded-full border border-ink/10 bg-white px-5 py-2.5 text-sm font-600 text-ink-700 shadow-soft"${ri(i % 4)}>${parseMd(t, 'light')}</span>`
              )
              .join('')}
          </div>
        </div>
      </section>`
      )}

      ${when(
        has(m.ctaHeading) || has(m.ctaSubcopy),
        `<section class="container-x py-20">
        <div class="reveal relative overflow-hidden rounded-[2.5rem] bg-brand-700 px-8 py-16 text-center text-white shadow-lift sm:px-16 sm:py-20">
          <div class="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-600/60"></div>
          <div class="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-sand-400/20"></div>
          <div class="relative">
            ${when(
              has(m.ctaHeading),
              `<h2 class="mx-auto max-w-2xl font-display text-4xl font-600 sm:text-5xl">${parseMd(m.ctaHeading, 'dark')}</h2>`
            )}
            ${when(has(m.ctaSubcopy), `<p class="mx-auto mt-5 max-w-xl text-white/75">${parseMd(m.ctaSubcopy, 'dark')}</p>`)}
            ${contactCta(
              c,
              `<div class="mt-9 flex justify-center"><a href="/#contact" class="btn-gold">${parseMd(m.ctaButton || 'Talk to us', 'gold')}</a></div>`
            )}
          </div>
        </div>
      </section>`
      )}
    </main>
    ${footerHtml(c, '/')}`
}
