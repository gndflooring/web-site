// "Website" admin page: edit the public site's content (site.json) and
// images, save to the content-draft branch, and Publish (merge → main →
// existing CI/CD). GitHub auth is the user's own account via device flow.
import seed from '../content/site.json'
import {
  ghConfigured,
  ghConnected,
  ghUser,
  ghDisconnect,
  ghStartDeviceFlow,
  ghPollToken,
  ghEnsureDraft,
  ghLoadSiteJson,
  ghCommitDraft,
  ghPublish,
  ghDeployStatus,
  ghResizeImage,
} from './github.js'

const $ = (id) => document.getElementById(id)
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function toast(msg) {
  const t = $('toast')
  if (!t) return
  t.textContent = msg
  t.style.opacity = '1'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => (t.style.opacity = '0'), 2800)
}

const obj = (label, fields) => ({ t: 'obj', fields, label })
const SCHEMA = [
  { key: 'meta', label: 'SEO / Meta', fields: [
    { k: 'title', t: 'text', label: 'Page title' },
    { k: 'description', t: 'textarea', label: 'Meta description' },
    { k: 'ogTitle', t: 'text', label: 'Social title' },
    { k: 'ogDescription', t: 'textarea', label: 'Social description' },
  ] },
  { key: 'hero', label: 'Hero', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow' },
    { k: 'headlineLead', t: 'text', label: 'Headline (lead)' },
    { k: 'highlight', t: 'text', label: 'Headline (highlight word)' },
    { k: 'headlineRest', t: 'text', label: 'Headline (rest)' },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy' },
    { k: 'ctaPrimary', t: 'text', label: 'Primary button' },
    { k: 'ctaSecondary', t: 'text', label: 'Secondary button' },
    { k: 'image', t: 'image', label: 'Background image' },
    { k: 'stats', t: 'list', of: obj('Stat', [
      { k: 'value', t: 'text', label: 'Value' }, { k: 'label', t: 'text', label: 'Label' },
    ]) },
  ] },
  { key: 'trust', label: 'Trust strip', listString: true },
  { key: 'services', label: 'Services', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow' },
    { k: 'heading', t: 'text', label: 'Heading' },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy' },
    { k: 'items', t: 'list', of: obj('Service', [
      { k: 'title', t: 'text', label: 'Title' },
      { k: 'desc', t: 'textarea', label: 'Description' },
      { k: 'bullets', t: 'list', of: 'string', label: 'Bullets' },
      { k: 'image', t: 'image', label: 'Image' },
      { k: 'alt', t: 'text', label: 'Image alt' },
    ]) },
  ] },
  { key: 'about', label: 'Why Us', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow' },
    { k: 'headingLead', t: 'text', label: 'Heading (line 1)' },
    { k: 'headingRest', t: 'text', label: 'Heading (line 2)' },
    { k: 'body', t: 'textarea', label: 'Body' },
    { k: 'image', t: 'image', label: 'Image' },
    { k: 'alt', t: 'text', label: 'Image alt' },
    { k: 'badgeValue', t: 'text', label: 'Badge value' },
    { k: 'badgeLabel', t: 'text', label: 'Badge label' },
    { k: 'features', t: 'list', of: obj('Feature', [
      { k: 'title', t: 'text', label: 'Title' }, { k: 'body', t: 'textarea', label: 'Body' },
    ]) },
  ] },
  { key: 'process', label: 'Process', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow' },
    { k: 'heading', t: 'text', label: 'Heading' },
    { k: 'steps', t: 'list', of: obj('Step', [
      { k: 'title', t: 'text', label: 'Title' }, { k: 'desc', t: 'textarea', label: 'Description' },
    ]) },
  ] },
  { key: 'gallery', label: 'Gallery / Projects', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow' },
    { k: 'heading', t: 'text', label: 'Heading' },
    { k: 'ctaLabel', t: 'text', label: 'CTA label' },
    { k: 'items', t: 'list', of: obj('Project', [
      { k: 'image', t: 'image', label: 'Photo' },
      { k: 'alt', t: 'text', label: 'Alt text' },
      { k: 'caption', t: 'text', label: 'Caption' },
    ]) },
  ] },
  { key: 'testimonials', label: 'Testimonials', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow' },
    { k: 'heading', t: 'text', label: 'Heading' },
    { k: 'items', t: 'list', of: obj('Testimonial', [
      { k: 'quote', t: 'textarea', label: 'Quote' },
      { k: 'name', t: 'text', label: 'Name' },
      { k: 'role', t: 'text', label: 'Role' },
    ]) },
  ] },
  { key: 'ctaBand', label: 'Call-to-action band', fields: [
    { k: 'heading', t: 'text', label: 'Heading' },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy' },
    { k: 'primaryLabel', t: 'text', label: 'Primary button' },
    { k: 'callLabel', t: 'text', label: 'Call button label' },
    { k: 'callHref', t: 'text', label: 'Call link (tel:)' },
  ] },
  { key: 'contact', label: 'Contact', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow' },
    { k: 'heading', t: 'text', label: 'Heading' },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy' },
    { k: 'phone', t: 'text', label: 'Phone (display)' },
    { k: 'phoneHref', t: 'text', label: 'Phone link (tel:)' },
    { k: 'email', t: 'text', label: 'Email' },
    { k: 'serviceArea', t: 'text', label: 'Service area' },
    { k: 'address', t: 'text', label: 'Address' },
    { k: 'hours', t: 'text', label: 'Hours' },
  ] },
  { key: 'footer', label: 'Footer', fields: [
    { k: 'blurb', t: 'textarea', label: 'Blurb' },
    { k: 'phone', t: 'text', label: 'Phone (display)' },
    { k: 'phoneHref', t: 'text', label: 'Phone link (tel:)' },
    { k: 'email', t: 'text', label: 'Email' },
    { k: 'hours', t: 'text', label: 'Hours' },
    { k: 'license', t: 'text', label: 'License line' },
    { k: 'note', t: 'textarea', label: 'Bottom note' },
  ] },
]

let content = null
let pending = [] // [{ path, base64 }] images queued for the next commit
let busy = false

const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), content)
function set(path, val) {
  const ks = path.split('.')
  let o = content
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}
    o = o[ks[i]]
  }
  o[ks[ks.length - 1]] = val
}

function field(f, path) {
  const id = 'f_' + path.replace(/[^\w]/g, '_')
  const v = get(path)
  if (f.t === 'textarea')
    return `<label class="block text-sm font-600">${esc(f.label)}
      <textarea id="${id}" data-path="${path}" rows="3" class="field mt-1">${esc(v || '')}</textarea></label>`
  if (f.t === 'image')
    return `<div class="block text-sm font-600">${esc(f.label)}
      <div class="mt-1 flex items-center gap-3">
        <img src="${esc(v || '')}" alt="" class="h-16 w-24 rounded-lg border border-line object-cover bg-app"/>
        <div class="flex-1">
          <input type="file" accept="image/*" data-img="${path}" class="block w-full text-xs"/>
          <p class="mt-1 truncate text-[11px] text-muted">${esc(v || '(none)')}</p>
        </div>
      </div></div>`
  return `<label class="block text-sm font-600">${esc(f.label)}
    <input id="${id}" data-path="${path}" value="${esc(v || '')}" class="field mt-1"/></label>`
}

function listString(path, label) {
  const arr = get(path) || []
  return `<div class="rounded-xl border border-line p-3">
    <p class="text-xs font-700 uppercase tracking-wider text-muted">${esc(label)}</p>
    <div class="mt-2 space-y-2">
      ${arr
        .map(
          (s, i) => `<div class="flex gap-2">
        <input data-path="${path}.${i}" value="${esc(s)}" class="field"/>
        <button data-del="${path}.${i}" class="btn-ghost shrink-0">✕</button>
      </div>`
        )
        .join('')}
    </div>
    <button data-add="${path}" data-kind="string" class="mt-2 text-xs font-600 text-brand-700">+ Add</button>
  </div>`
}

function listObject(path, of) {
  const arr = get(path) || []
  return `<div class="space-y-3">
    ${arr
      .map((_, i) => {
        const ip = `${path}.${i}`
        return `<div class="rounded-xl border border-line p-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-700 uppercase tracking-wider text-muted">${esc(of.label)} ${i + 1}</p>
          <div class="flex gap-1.5">
            <button data-move="${ip}" data-dir="-1" class="btn-ghost !px-2" title="Up">↑</button>
            <button data-move="${ip}" data-dir="1" class="btn-ghost !px-2" title="Down">↓</button>
            <button data-del="${ip}" class="btn-danger !px-2">Delete</button>
          </div>
        </div>
        <div class="space-y-3">
          ${of.fields
            .map((sf) =>
              sf.t === 'list' && sf.of === 'string'
                ? listString(`${ip}.${sf.k}`, sf.label)
                : field(sf, `${ip}.${sf.k}`)
            )
            .join('')}
        </div>
      </div>`
      })
      .join('') || '<p class="text-sm text-muted">None yet.</p>'}
    <button data-add="${path}" data-kind="obj" class="text-sm font-600 text-brand-700">+ Add ${esc(of.label)}</button>
  </div>`
}

function blankFor(of) {
  if (of === 'string') return ''
  const o = {}
  for (const sf of of.fields) o[sf.k] = sf.t === 'list' ? [] : ''
  return o
}

function sectionHtml(sec, idx) {
  let inner
  if (sec.listString) inner = listString(sec.key, sec.label)
  else
    inner = sec.fields
      .map((f) =>
        f.t === 'list'
          ? `<div><p class="text-xs font-700 uppercase tracking-wider text-muted">${esc(f.label || f.k)}</p><div class="mt-2">${listObject(`${sec.key}.${f.k}`, f.of)}</div></div>`
          : field(f, `${sec.key}.${f.k}`)
      )
      .join('')
  return `<details class="card p-5" ${idx === 0 ? 'open' : ''}>
    <summary class="cursor-pointer select-none text-base font-700 text-ink flex items-center justify-between">
      <span>${esc(sec.label)}</span>
      <span class="text-xs font-600 text-muted bg-app px-2 py-0.5 rounded border border-line uppercase">${esc(sec.key)}</span>
    </summary>
    <div class="mt-4 space-y-4 pt-4 border-t border-line">${inner}</div>
  </details>`
}

function parseMd(s, bgContext = 'light') {
  if (!s) return ''
  let text = esc(s)
  let hl = 'text-[#2f7cb5] font-600' // light default
  if (bgContext === 'dark') hl = 'text-[#d8b985] font-600'
  else if (bgContext === 'sand' || bgContext === 'gold') hl = 'text-[#134e4a] font-700' // teal on sand!
  else if (bgContext === 'eyebrow-light') hl = 'text-[#0f766e] font-700'

  text = text.replace(/\*([^*]+)\*/g, `<span class="italic ${hl}">$1</span>`)
  text = text.replace(/\*\*([^*]+)\*\*/g, `<strong class="font-bold">$1</strong>`)
  text = text.replace(/_([^_]+)_/g, `<em class="italic">$1</em>`)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" class="underline hover:opacity-80">$1</a>`)
  return text
}

function renderLivePreview() {
  const d = content || seed
  const prev = document.getElementById('cmsLivePreview')
  if (!prev) return

  const heroHeadline = d.hero?.headline || `${d.hero?.headlineLead || ''} *${d.hero?.highlight || ''}* ${d.hero?.headlineRest || ''}`

  prev.innerHTML = `
    <!-- HEADER -->
    <header class="bg-brand-900 border-b border-white/10 px-6 py-4 flex items-center justify-between text-white sticky top-0 z-30">
      <div class="flex items-center gap-3">
        <span class="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 font-display text-lg font-700">G&amp;D</span>
        <span class="font-display text-xl font-600 tracking-tight">G&amp;D Flooring</span>
      </div>
      <nav class="hidden lg:flex items-center gap-9 text-sm font-500 text-white/85">
        <a href="#services">Services</a>
        <a href="#about">Why Us</a>
        <a href="#process">Process</a>
        <a href="#gallery">Gallery</a>
        <a href="#contact">Contact</a>
      </nav>
      <button class="btn-gold hidden lg:inline-flex">${parseMd(d.hero?.ctaPrimary || 'Get a Free Quote', 'gold')}</button>
    </header>

    <!-- HERO WITH GPU-ACCELERATED SMOOTH BG ANIMATION -->
    <section class="relative bg-ink text-white p-8 md:p-14 overflow-hidden min-h-[80vh] flex items-center">
      ${d.hero?.image ? `
        <div class="absolute inset-0 -z-10 overflow-hidden">
          <img src="${esc(d.hero.image)}" class="h-full w-full object-cover opacity-40 will-change-transform animate-[heroSmoothZoom_24s_ease-in-out_infinite]">
          <div class="absolute inset-0 bg-gradient-to-br from-ink/80 via-brand-800/70 to-brand-700/55"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent"></div>
        </div>
      ` : ''}

      <div class="max-w-3xl relative z-10">
        <p class="eyebrow text-sand-300">
          <span class="h-px w-8 bg-sand-300"></span> ${parseMd(d.hero?.eyebrow, 'dark')}
        </p>
        <h1 class="mt-6 font-display text-4xl md:text-6xl font-600 leading-[1.05] text-white">
          ${parseMd(heroHeadline, 'dark')}
        </h1>
        <p class="mt-7 max-w-xl text-lg leading-relaxed text-white/80">
          ${parseMd(d.hero?.subcopy, 'dark')}
        </p>
        <div class="mt-10 flex flex-wrap items-center gap-4">
          <a href="#contact" class="btn-gold">${parseMd(d.hero?.ctaPrimary, 'gold')}</a>
          <a href="#services" class="btn-ghost">
            ${parseMd(d.hero?.ctaSecondary, 'dark')}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </a>
        </div>
        ${d.hero?.stats ? `
          <dl class="mt-16 flex flex-wrap gap-8 border-t border-white/15 pt-8">
            ${d.hero.stats.map(s => `
              <div>
                <dt class="text-sm text-white/60">${parseMd(s.label, 'dark')}:</dt>
                <dd class="font-display text-3xl font-600 text-white mt-1">${parseMd(s.value, 'dark')}</dd>
              </div>
            `).join('')}
          </dl>
        ` : ''}
      </div>
    </section>

    <!-- TRUST STRIP (Sand BG -> Teal Highlight) -->
    <section class="border-y border-ink/5 bg-cream-200/60 py-6">
      <div class="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-center text-sm font-500 text-muted">
        ${(d.trust || []).map(t => `<span>${parseMd(t, 'sand')}</span>`).join('')}
      </div>
    </section>

    <!-- SERVICES (Light BG -> Brand Blue Highlight) -->
    <section class="py-20 bg-cream text-ink">
      <div class="max-w-7xl mx-auto px-6">
        <div class="mx-auto max-w-2xl text-center">
          <p class="eyebrow justify-center"><span class="h-px w-8 bg-brand-600"></span> ${parseMd(d.services?.eyebrow, 'eyebrow-light')} <span class="h-px w-8 bg-brand-600"></span></p>
          <h2 class="mt-5 font-display text-4xl font-600 text-ink sm:text-5xl">${parseMd(d.services?.heading, 'light')}</h2>
          <p class="mt-5 text-lg text-muted">${parseMd(d.services?.subcopy, 'light')}</p>
        </div>

        <div class="mt-16 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
          ${(d.services?.items || []).map(it => {
            const imgs = it.images || (it.image ? [it.image] : [])
            return `
              <article class="card-lift group overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-ink/5 flex flex-col justify-between">
                <div>
                  ${imgs.length > 0 ? `
                    <div class="media-zoom relative aspect-[4/3] overflow-hidden">
                      <img src="${esc(imgs[0])}" class="h-full w-full object-cover">
                      ${imgs.length > 1 ? `<span class="absolute bottom-2 right-2 bg-ink/80 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">📷 Carousel (${imgs.length})</span>` : ''}
                    </div>
                  ` : ''}
                  <div class="p-7">
                    <h3 class="font-display text-xl font-600 text-ink">${parseMd(it.title, 'light')}</h3>
                    <p class="mt-3 text-sm leading-relaxed text-muted">${parseMd(it.desc, 'light')}</p>
                    ${it.bullets ? `
                      <ul class="mt-5 space-y-2 text-sm text-ink-700">
                        ${it.bullets.map(b => `<li class="flex items-center gap-2"><span class="text-brand-600">✓</span> ${parseMd(b, 'light')}</li>`).join('')}
                      </ul>
                    ` : ''}
                  </div>
                </div>
                <div class="px-7 pb-7">
                  <a href="#contact" class="inline-flex items-center gap-1.5 text-sm font-600 text-brand-700">Request service →</a>
                </div>
              </article>
            `
          }).join('')}
        </div>
      </div>
    </section>

    <section class="bg-[#15212b] text-white p-8 md:p-12">
      <div class="max-w-2xl">
        <p class="text-xs font-600 text-[#e2bf8b] uppercase tracking-wider">${esc(d.about?.eyebrow)}</p>
        <h2 class="font-display text-3xl font-600 mt-2">${esc(d.about?.headingLead)}<br>${esc(d.about?.headingRest)}</h2>
        <p class="text-xs text-white/70 mt-3 leading-relaxed">${esc(d.about?.body)}</p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          ${(d.about?.features || []).map(f => `
            <div class="p-4 bg-white/5 rounded-2xl border border-white/10">
              <h4 class="font-display font-600 text-sm text-white">${esc(f.title)}</h4>
              <p class="text-xs text-white/60 mt-1">${esc(f.body)}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <footer class="bg-slate-950 text-white/60 p-8 text-xs border-t border-white/10">
      <div class="flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <span class="font-display text-base font-600 text-white">G&amp;D Flooring</span>
          <p class="text-[11px] mt-1">${esc(d.footer?.blurb)}</p>
        </div>
        <div class="text-right">
          <p>${esc(d.footer?.phone)} · ${esc(d.footer?.email)}</p>
          <p class="text-[10px] text-white/40 mt-1">${esc(d.footer?.license)}</p>
        </div>
      </div>
    </footer>
  `
}

function renderEditor(v) {
  v.innerHTML = `
    <div class="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
      <div class="text-sm">
        <span class="font-700">Connected:</span>
        <span class="text-muted">@${esc(ghUser() || 'github')}</span>
      </div>
      <button id="wDisc" class="btn-ghost">Disconnect</button>
      <a href="/draft/" target="_blank" rel="noopener" class="btn-ghost text-xs font-semibold bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200 transition flex items-center gap-1.5">
        👁️ View Live Draft (/draft) ↗
      </a>
      <span id="wStatus" class="text-sm text-muted"></span>
      <div class="ml-auto flex gap-2">
        <button id="wSave" class="btn-ghost">Save draft</button>
        <button id="wPub" class="btn-primary">Publish</button>
      </div>
    </div>
    
    <div class="flex gap-6 h-[calc(100vh-220px)] overflow-hidden">
      <!-- Left Form Pane -->
      <div class="w-1/2 overflow-y-auto space-y-4 pr-2">
        <p class="text-sm text-muted">Edits save to <code>content-draft</code>. <span class="font-600">Publish</span> merges to <code>main</code>.</p>
        <div class="space-y-4">${SCHEMA.map(sectionHtml).join('')}</div>
      </div>

      <!-- Right Live Preview Pane -->
      <div class="w-1/2 bg-slate-900 rounded-2xl border border-line overflow-hidden flex flex-col shadow-lg">
        <div class="h-9 bg-slate-950 px-4 flex items-center justify-between text-xs text-slate-400 border-b border-slate-800">
          <span class="font-mono text-[11px] text-slate-300">Live Website Preview (Pixel Parity)</span>
          <span class="bg-brand-600/30 text-brand-300 px-2 py-0.5 rounded text-[10px] font-semibold border border-brand-500/30">Live Sync</span>
        </div>
        <div id="cmsLivePreview" class="flex-1 overflow-y-auto bg-[#15212b]"></div>
      </div>
    </div>`

  renderLivePreview()

  // scalar binding (no re-render → keeps focus while typing)
  v.querySelectorAll('[data-path]').forEach((el) =>
    el.addEventListener('input', () => {
      set(el.dataset.path, el.value)
      renderLivePreview()
    })
  )
  // image pick → resize → queue + set url
  v.querySelectorAll('[data-img]').forEach((inp) =>
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0]
      if (!file) return
      try {
        const r = await ghResizeImage(file)
        pending = pending.filter((p) => p.path !== r.path)
        pending.push({ path: r.path, base64: r.base64 })
        set(inp.dataset.img, r.url)
        const img = inp.closest('.flex').querySelector('img')
        if (img) img.src = r.preview
        const cap = inp.parentElement.querySelector('p')
        if (cap) cap.textContent = r.url + ' (queued)'
        toast('Image queued — Save draft to upload')
      } catch (e) {
        toast('Image failed: ' + e.message)
      }
    })
  )
  // list add / delete / move → mutate content, re-render
  const rerender = () => renderEditor(v)
  v.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const arr = get(b.dataset.add) || []
      const sec = SCHEMA.find((s) => b.dataset.add.startsWith(s.key))
      let of = 'string'
      if (b.dataset.kind === 'obj') {
        const fk = b.dataset.add.split('.').slice(-1)[0]
        const fdef = (sec.fields || []).find((f) => f.k === fk)
        of = fdef ? fdef.of : 'string'
      }
      arr.push(blankFor(of))
      set(b.dataset.add, arr)
      rerender()
    })
  )
  v.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const ks = b.dataset.del.split('.')
      const i = +ks.pop()
      const arr = get(ks.join('.')) || []
      arr.splice(i, 1)
      rerender()
    })
  )
  v.querySelectorAll('[data-move]').forEach((b) =>
    b.addEventListener('click', () => {
      const ks = b.dataset.move.split('.')
      const i = +ks.pop()
      const arr = get(ks.join('.')) || []
      const j = i + Number(b.dataset.dir)
      if (j < 0 || j >= arr.length) return
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      rerender()
    })
  )

  $('wDisc').addEventListener('click', () => {
    ghDisconnect()
    mountWebsite(v)
  })
  $('wSave').addEventListener('click', () => save(v, false))
  $('wPub').addEventListener('click', () => save(v, true))
}

async function save(v, publish) {
  if (busy) return
  busy = true
  const sBtn = $('wSave')
  const pBtn = $('wPub')
  const st = $('wStatus')
  const btn = publish ? pBtn : sBtn
  const orig = btn.textContent
  sBtn.disabled = pBtn.disabled = true
  btn.textContent = publish ? 'Publishing…' : 'Saving…'
  try {
    await ghCommitDraft(content, pending, publish ? 'Site content (pre-publish)' : 'Update site content')
    pending = []
    if (!publish) {
      btn.textContent = 'Saved ✓'
      st.textContent = 'Draft saved to content-draft.'
    } else {
      await ghPublish('Publish site content')
      btn.textContent = 'Published ✓'
      st.textContent = 'Merged to main — building…'
      pollDeploy(st)
    }
  } catch (e) {
    st.textContent = ''
    toast((publish ? 'Publish' : 'Save') + ' failed: ' + e.message)
  } finally {
    setTimeout(() => {
      sBtn.disabled = pBtn.disabled = false
      btn.textContent = orig
    }, 1200)
    busy = false
  }
}

async function pollDeploy(st) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 12000))
    try {
      const d = await ghDeployStatus()
      if (!d) continue
      if (d.status === 'completed') {
        st.innerHTML =
          d.conclusion === 'success'
            ? `Live ✓ — <a class="text-brand-700 underline" href="https://www.gnd-flooring.com/" target="_blank" rel="noopener">view site</a>`
            : `Deploy ${esc(d.conclusion)} — <a class="text-brand-700 underline" href="${esc(d.url)}" target="_blank" rel="noopener">logs</a>`
        return
      }
      st.textContent = `Building… (${d.status})`
    } catch {
      return
    }
  }
}

export async function mountWebsite(v) {
  if (!ghConfigured()) {
    v.innerHTML = `<div class="card mx-auto max-w-lg p-8 text-center">
      <p class="font-700">Website editor not configured</p>
      <p class="mt-2 text-sm text-muted">Set <code>GITHUB_CLIENT_ID</code> (a GitHub OAuth App with Device Flow enabled) and redeploy. The Apps Script device relay must also be deployed.</p></div>`
    return
  }
  if (!ghConnected()) {
    v.innerHTML = `<div class="card mx-auto max-w-lg p-8 text-center">
      <p class="text-lg font-700">Connect GitHub</p>
      <p class="mt-2 text-sm text-muted">Publishing commits to the repository as you. Sign in with your own GitHub account — nothing is stored.</p>
      <button id="wConnect" class="btn-primary mt-6">Connect GitHub</button>
      <div id="wFlow" class="mt-6 text-sm"></div></div>`
    $('wConnect').addEventListener('click', async () => {
      const flow = $('wFlow')
      $('wConnect').disabled = true
      flow.textContent = 'Requesting code…'
      try {
        const d = await ghStartDeviceFlow()
        flow.innerHTML = `<p>1. Open <a class="text-brand-700 underline" href="${esc(d.verification_uri)}" target="_blank" rel="noopener">${esc(d.verification_uri)}</a></p>
          <p class="mt-2">2. Enter this code:</p>
          <p class="my-2 font-mono text-2xl font-700 tracking-widest">${esc(d.user_code)}</p>
          <p class="text-muted">Waiting for authorization…</p>`
        window.open(d.verification_uri, '_blank', 'noopener')
        await ghPollToken(d.device_code, d.interval, d.expires_in)
        await ghEnsureDraft()
        toast('GitHub connected')
        mountWebsite(v)
      } catch (e) {
        flow.innerHTML = `<p class="text-rose-600">${esc(e.message)}</p>`
        $('wConnect').disabled = false
      }
    })
    return
  }
  // connected → load content (draft → main → bundled seed)
  v.innerHTML = '<p class="p-10 text-center text-muted">Loading content…</p>'
  try {
    await ghEnsureDraft()
    content = (await ghLoadSiteJson()) || JSON.parse(JSON.stringify(seed))
  } catch (e) {
    content = JSON.parse(JSON.stringify(seed))
    toast('Loaded local default (' + e.message + ')')
  }
  pending = []
  renderEditor(v)
}
