// "Website" admin page — the CMS Editor Studio.
//
// Layout follows the approved design in admin/cms-studio.html: a full-height
// split studio with a schema-driven form on the left and, on the right, the
// actual site rendered by src/content/render.js — the same module the build
// and the /draft preview use, so the pane is the page.
//
// Content is site.json: edits save to the content-draft branch, Publish merges
// to main → existing CI/CD. GitHub auth is the user's own account (device flow).
import seed from '../content/site.json'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { renderPage, renderCommercialPage, esc, has } from '../content/render.js'
import { initCarousels } from '../components/carousel.js'
import { initLightbox } from '../components/lightbox.js'
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
  ghDraftStatus,
  ghSyncDraft,
  ghResizeImage,
} from './github.js'

const $ = (id) => document.getElementById(id)

function toast(msg) {
  const t = $('toast')
  if (!t) return
  t.textContent = msg
  t.style.opacity = '1'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => (t.style.opacity = '0'), 2800)
}

/* =============================================================
   Content schema — drives the form and the "+ Add" blanks.
   `md` marks fields the site renders through the markdown parser;
   `ratio` is the aspect the cropper opens at.
   ============================================================= */
const obj = (label, fields) => ({ t: 'obj', fields, label })
const PHOTO = obj('Photo', [
  { k: 'src', t: 'image', label: 'Photo' },
  { k: 'alt', t: 'text', label: 'Alt text' },
  { k: 'caption', t: 'text', label: 'Caption', md: true },
  { k: 'blur', t: 'number', label: 'Blur' },
])

const HOME_SCHEMA = [
  { key: 'meta', label: 'SEO / Meta', fields: [
    { k: 'title', t: 'text', label: 'Page title' },
    { k: 'description', t: 'textarea', label: 'Meta description' },
    { k: 'ogTitle', t: 'text', label: 'Social title' },
    { k: 'ogDescription', t: 'textarea', label: 'Social description' },
  ] },
  { key: 'brand', label: 'Brand & Logo', fields: [
    { k: 'name', t: 'text', label: 'Business name' },
    { k: 'logo', t: 'image', label: 'Logo (SVG recommended)', ratio: 1, svg: true },
  ] },
  { key: 'hero', label: 'Hero Section', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'headline', t: 'text', label: 'Headline — wrap the accent word in *asterisks*', md: true },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy', md: true },
    { k: 'ctaPrimary', t: 'text', label: 'Primary button', md: true },
    { k: 'ctaSecondary', t: 'text', label: 'Secondary button', md: true },
    { k: 'image', t: 'image', label: 'Background hero image', ratio: 16 / 9 },
    { k: 'stats', t: 'list', label: 'Hero stats', of: obj('Stat', [
      { k: 'label', t: 'text', label: 'Label', md: true },
      { k: 'value', t: 'text', label: 'Value', md: true },
    ]) },
  ] },
  { key: 'trust', label: 'Trust Strip', listString: true, md: true },
  { key: 'services', label: 'Services', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'heading', t: 'text', label: 'Heading', md: true },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy', md: true },
    { k: 'items', t: 'list', label: 'Service cards', of: obj('Service', [
      { k: 'title', t: 'text', label: 'Title', md: true },
      { k: 'desc', t: 'textarea', label: 'Description', md: true },
      { k: 'bullets', t: 'list', of: 'string', label: 'Bullets', md: true },
      { k: 'images', t: 'images', label: 'Photos — shown as a carousel', ratio: 4 / 3 },
    ]) },
  ] },
  { key: 'about', label: 'Why Us / About', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'headingLead', t: 'text', label: 'Heading (line 1)', md: true },
    { k: 'headingRest', t: 'text', label: 'Heading (line 2)', md: true },
    { k: 'body', t: 'textarea', label: 'Body', md: true },
    { k: 'image', t: 'image', label: 'Image', ratio: 4 / 5 },
    { k: 'alt', t: 'text', label: 'Image alt' },
    { k: 'badgeValue', t: 'text', label: 'Badge value', md: true },
    { k: 'badgeLabel', t: 'text', label: 'Badge label', md: true },
    { k: 'features', t: 'list', label: 'Feature cards', of: obj('Feature', [
      { k: 'title', t: 'text', label: 'Title', md: true },
      { k: 'body', t: 'textarea', label: 'Body', md: true },
    ]) },
  ] },
  { key: 'process', label: 'Process Steps', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'heading', t: 'text', label: 'Heading', md: true },
    { k: 'steps', t: 'list', label: 'Steps', of: obj('Step', [
      { k: 'title', t: 'text', label: 'Title', md: true },
      { k: 'desc', t: 'textarea', label: 'Description', md: true },
      { k: 'image', t: 'image', label: 'Header image (optional)', ratio: 16 / 9 },
      { k: 'alt', t: 'text', label: 'Image alt' },
    ]) },
  ] },
  { key: 'gallery', label: 'Gallery Masonry', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'heading', t: 'text', label: 'Heading', md: true },
    { k: 'ctaLabel', t: 'text', label: 'CTA label', md: true },
    { k: 'items', t: 'list', label: 'Masonry tiles', of: obj('Tile', [
      { k: 'images', t: 'images', label: 'Photos — extra photos become a carousel', ratio: 0 },
    ]) },
  ] },
  { key: 'testimonials', label: 'Testimonials', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'heading', t: 'text', label: 'Heading', md: true },
    { k: 'items', t: 'list', label: 'Quotes', of: obj('Testimonial', [
      { k: 'quote', t: 'textarea', label: 'Quote', md: true },
      { k: 'name', t: 'text', label: 'Name', md: true },
      { k: 'role', t: 'text', label: 'Role', md: true },
      { k: 'images', t: 'images', label: 'Photos — carousel on the left of the card', ratio: 1 },
    ]) },
  ] },
  { key: 'ctaBand', label: 'Call-to-action Band', fields: [
    { k: 'heading', t: 'text', label: 'Heading', md: true },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy', md: true },
    { k: 'primaryLabel', t: 'text', label: 'Primary button', md: true },
    { k: 'callLabel', t: 'text', label: 'Call button label', md: true },
    { k: 'callHref', t: 'text', label: 'Call link (tel:)' },
  ] },
  { key: 'contact', label: 'Contact', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'heading', t: 'text', label: 'Heading', md: true },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy', md: true },
    { k: 'phone', t: 'text', label: 'Phone (display)', md: true },
    { k: 'phoneHref', t: 'text', label: 'Phone link (tel:)' },
    { k: 'email', t: 'text', label: 'Email', md: true },
    { k: 'serviceArea', t: 'text', label: 'Service area', md: true },
    { k: 'address', t: 'text', label: 'Address', md: true },
    { k: 'hours', t: 'text', label: 'Hours', md: true },
  ] },
  { key: 'footer', label: 'Footer', fields: [
    { k: 'blurb', t: 'textarea', label: 'Blurb', md: true },
    { k: 'phone', t: 'text', label: 'Phone (display)', md: true },
    { k: 'phoneHref', t: 'text', label: 'Phone link (tel:)' },
    { k: 'email', t: 'text', label: 'Email', md: true },
    { k: 'hours', t: 'text', label: 'Hours', md: true },
    { k: 'license', t: 'text', label: 'License line', md: true },
    { k: 'note', t: 'textarea', label: 'Bottom note', md: true },
  ] },
]

// The commercial page lives under one `commercial` key but is split into
// several cards; `id` keeps them distinct in the UI while `key` stays the
// path prefix.
const COMMERCIAL_SCHEMA = [
  { id: 'commercialHero', key: 'commercial', label: 'Hero', fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow', md: true },
    { k: 'heading', t: 'text', label: 'Heading', md: true },
    { k: 'subcopy', t: 'textarea', label: 'Sub-copy', md: true },
    { k: 'image', t: 'image', label: 'Background image', ratio: 16 / 9 },
    { k: 'ctaPrimary', t: 'text', label: 'Primary button', md: true },
    { k: 'backLabel', t: 'text', label: 'Back-to-residential button', md: true },
  ] },
  { id: 'commercialLink', key: 'commercial', label: 'Link from the home page', fields: [
    { k: 'ctaLabel', t: 'text', label: 'Button label beside “Explore Services”', md: true },
    { k: 'metaTitle', t: 'text', label: 'Page title (SEO)' },
    { k: 'metaDescription', t: 'textarea', label: 'Meta description (SEO)' },
  ] },
  { id: 'commercialServices', key: 'commercial', label: 'Service Cards', fields: [
    { k: 'introHeading', t: 'text', label: 'Section heading', md: true },
    { k: 'intro', t: 'textarea', label: 'Section intro', md: true },
    { k: 'items', t: 'list', label: 'Cards', of: obj('Service', [
      { k: 'title', t: 'text', label: 'Title', md: true },
      { k: 'desc', t: 'textarea', label: 'Description', md: true },
      { k: 'bullets', t: 'list', of: 'string', label: 'Bullets', md: true },
      { k: 'images', t: 'images', label: 'Photos — shown as a carousel', ratio: 4 / 3 },
    ]) },
  ] },
  { id: 'commercialSectors', key: 'commercial', label: 'Sectors', fields: [
    { k: 'sectorsHeading', t: 'text', label: 'Heading', md: true },
    { k: 'sectors', t: 'list', of: 'string', label: 'Sectors', md: true },
  ] },
  { id: 'commercialCta', key: 'commercial', label: 'Call-to-action Band', fields: [
    { k: 'ctaHeading', t: 'text', label: 'Heading', md: true },
    { k: 'ctaSubcopy', t: 'textarea', label: 'Sub-copy', md: true },
    { k: 'ctaButton', t: 'text', label: 'Button label', md: true },
  ] },
]

const PAGES = [
  { id: 'home', label: 'Home page', schema: HOME_SCHEMA },
  { id: 'commercial', label: 'Commercial page', schema: COMMERCIAL_SCHEMA },
]
const sectionId = (sec) => sec.id || sec.key

// Every field defined for a given path prefix, across all pages — the list
// editors resolve their item shape through this.
const FIELDS_BY_KEY = {}
for (const page of PAGES)
  for (const sec of page.schema) {
    if (sec.listString) continue
    FIELDS_BY_KEY[sec.key] = [...(FIELDS_BY_KEY[sec.key] || []), ...(sec.fields || [])]
  }

/* ---------- module state ---------- */
let content = null
let pending = [] // [{ path, base64 }] images queued for the next commit
let busy = false
let host = null // the #view element the studio is mounted in
const tabs = {} // list path → active index
let activePage = 'home'
const openSections = new Set(['hero'])
let paneScroll = 0
// Queued images have no file at their final /uploads/… URL until the draft is
// committed, so keep the local data URL for previewing them meanwhile.
const previews = {}
const imgSrc = (u) => (u && previews[u]) || u || ''

/* ---------- data helpers ---------- */
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

// Item descriptor ('string' | obj) of the list living at `path`.
function listDescriptor(path) {
  const ks = path.split('.')
  const listStringSection = PAGES.some((p) => p.schema.some((s) => s.key === ks[0] && s.listString))
  if (listStringSection) return 'string'
  let fields = FIELDS_BY_KEY[ks[0]]
  if (!fields) return 'string'
  let of = 'string'
  for (let i = 1; i < ks.length; i++) {
    if (/^\d+$/.test(ks[i])) continue
    const f = fields.find((x) => x.k === ks[i])
    if (!f) return 'string'
    if (f.t === 'images') return PHOTO
    if (f.t === 'list') {
      of = f.of
      fields = (of && of.fields) || []
    } else return 'string'
  }
  return of
}

function blankFor(of) {
  if (of === 'string') return ''
  const o = {}
  for (const sf of of.fields) o[sf.k] = sf.t === 'list' || sf.t === 'images' ? [] : sf.t === 'number' ? 0 : ''
  return o
}

function tabLabel(item, of, i) {
  const raw =
    item && typeof item === 'object'
      ? item.title || item.name || item.label || item.caption || item.images?.[0]?.caption || ''
      : ''
  const clean = String(raw).replace(/\*/g, '').trim()
  return clean ? (clean.length > 22 ? clean.slice(0, 21) + '…' : clean) : `${of.label} ${i + 1}`
}

/* =============================================================
   Migration — old drafts keep working.
   • hero headline used to be lead / highlight / rest
   • services, gallery and testimonials used a single image + alt
   ============================================================= */
export function migrate(c) {
  if (!c) return c
  const h = c.hero
  if (h) {
    if (!has(h.headline) && (has(h.headlineLead) || has(h.highlight) || has(h.headlineRest)))
      h.headline = `${h.headlineLead || ''} *${h.highlight || ''}* ${h.headlineRest || ''}`.replace(/\s+/g, ' ').trim()
    delete h.headlineLead
    delete h.highlight
    delete h.headlineRest
  }
  const toImages = (item, keepCaption) => {
    if (!Array.isArray(item.images)) {
      item.images = has(item.image)
        ? [{ src: item.image, alt: item.alt || '', caption: (keepCaption && item.caption) || '', blur: 0 }]
        : []
    } else {
      item.images = item.images.map((im) =>
        typeof im === 'string'
          ? { src: im, alt: '', caption: '', blur: 0 }
          : { src: im.src || im.image || '', alt: im.alt || '', caption: im.caption || '', blur: Number(im.blur) || 0 }
      )
    }
    delete item.image
    delete item.alt
    if (keepCaption) delete item.caption
  }
  ;(c.services?.items || []).forEach((it) => toImages(it, false))
  ;(c.gallery?.items || []).forEach((it) => toImages(it, true))
  ;(c.testimonials?.items || []).forEach((it) => toImages(it, false))
  ;(c.process?.steps || []).forEach((st) => {
    if (st.image == null) st.image = ''
    if (st.alt == null) st.alt = ''
  })
  return c
}

/* =============================================================
   Form pane
   ============================================================= */
const mdHint = (f) =>
  f.md
    ? `<span class="ml-1.5 font-500 normal-case tracking-normal text-brand-600" title="Markdown supported: *highlight*, **bold**, _italic_, [link](url)">*md*</span>`
    : ''

function field(f, path) {
  const id = 'f_' + path.replace(/[^\w]/g, '_')
  const v = get(path)
  const label = `<label for="${id}" class="mb-1 block text-xs font-700 text-ink">${esc(f.label)}${mdHint(f)}</label>`

  if (f.t === 'images') return imagesField(f, path)
  if (f.t === 'image') return imageField(f, path)
  if (f.t === 'textarea')
    return `<div>${label}<textarea id="${id}" data-path="${path}" rows="3" class="field text-xs">${esc(v || '')}</textarea></div>`
  return `<div>${label}<input id="${id}" data-path="${path}" value="${esc(v || '')}" class="field text-xs"/></div>`
}

const isQueued = (v) => pending.some((p) => v && v.endsWith(p.path.replace(/^public\//, '')))

function imageField(f, path) {
  const v = get(path)
  const blurPath = `${path}Blur`
  const blur = Number(get(blurPath)) || 0
  const isSvg = /\.svg($|\?)/i.test(String(v || ''))
  return `<div>
    <label class="mb-1 block text-xs font-700 text-ink">${esc(f.label)}</label>
    <div class="rounded-xl border border-line bg-app p-3">
      <div class="flex items-center gap-3">
        ${
          has(v)
            ? `<img src="${esc(imgSrc(v))}" alt="" class="h-14 w-20 shrink-0 rounded-lg border border-line bg-surface ${isSvg ? 'object-contain p-1' : 'object-cover'}"/>`
            : '<span class="grid h-14 w-20 shrink-0 place-items-center rounded-lg border border-dashed border-line bg-surface text-[10px] text-muted">none</span>'
        }
        <div class="min-w-0 flex-1">
          <div class="flex gap-1.5">
            <button type="button" data-crop="${path}" data-ratio="${f.ratio ?? 0}"${f.svg ? ' data-svg="1"' : ''} class="btn-ghost !px-2.5 !py-1.5 text-xs">📷 ${has(v) ? 'Replace' : 'Upload'}${f.svg ? '' : ' &amp; Crop'}</button>
            ${when(has(v), `<button type="button" data-clear="${path}" class="btn-ghost !px-2 !py-1.5 text-xs text-rose-600" title="Remove image">✕</button>`)}
          </div>
          <p class="mt-1 truncate text-[11px] text-muted">${esc(v || '(none)')}${isQueued(v) ? ' <span class="text-amber-700">(queued)</span>' : ''}${
            f.svg ? ' <span class="text-muted">· SVG uploads are kept as-is</span>' : ''
          }</p>
        </div>
      </div>
      ${when(has(v) && !f.svg, blurRow(blurPath, blur))}
    </div>
  </div>`
}

// Blur is stored, not baked: the site applies it as a CSS filter, which is
// what makes an image usable as a soft backdrop.
function blurRow(path, blur) {
  return `<div class="mt-2 flex items-center gap-2 border-t border-line pt-2">
    <span class="w-10 shrink-0 text-[11px] font-600 text-muted">Blur</span>
    <input type="range" data-num="${path}" min="0" max="24" step="1" value="${blur}" class="h-1 flex-1 accent-brand-600"/>
    <span class="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">${blur}px</span>
  </div>`
}

const when = (c, html) => (c ? html : '')

// Any number of photos, each with its own markdown caption and alt text.
function imagesField(f, path) {
  const arr = get(path) || []
  const ratio = f.ratio ?? 0
  return `<div>
    <p class="mb-2 text-xs font-700 uppercase tracking-wider text-muted">${esc(f.label)}
      <span class="ml-1 font-500 normal-case tracking-normal text-muted">${arr.length} photo${arr.length === 1 ? '' : 's'}</span></p>
    ${
      arr.length
        ? `<div class="grid grid-cols-2 gap-2">
      ${arr
        .map(
          (im, i) => `<div class="rounded-lg border border-line bg-surface p-2">
        <div class="relative">
          <img src="${esc(imgSrc(im.src))}" alt="" class="h-20 w-full rounded object-cover"/>
          <span class="absolute left-1 top-1 rounded bg-ink/70 px-1.5 text-[10px] font-600 text-white">${i + 1}</span>
          <button type="button" data-del="${path}.${i}" data-confirm="photo"
            class="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-xs text-white">✕</button>
        </div>
        <input data-path="${path}.${i}.caption" value="${esc(im.caption || '')}" placeholder="Caption (*md*)" class="field mt-1 !px-1.5 !py-1 text-[11px]"/>
        <input data-path="${path}.${i}.alt" value="${esc(im.alt || '')}" placeholder="Alt text" class="field mt-1 !px-1.5 !py-1 text-[11px]"/>
        ${blurRow(`${path}.${i}.blur`, Number(im.blur) || 0)}
        <div class="mt-1 flex gap-1">
          <button type="button" data-crop="${path}.${i}.src" data-ratio="${ratio}" class="btn-ghost !px-1.5 !py-1 text-[11px]">📷</button>
          <button type="button" data-move="${path}.${i}" data-dir="-1" class="btn-ghost !px-1.5 !py-1 text-[11px]" title="Move earlier">↑</button>
          <button type="button" data-move="${path}.${i}" data-dir="1" class="btn-ghost !px-1.5 !py-1 text-[11px]" title="Move later">↓</button>
          ${when(isQueued(im.src), '<span class="self-center text-[10px] text-amber-700">queued</span>')}
        </div>
      </div>`
        )
        .join('')}
    </div>`
        : '<p class="rounded-lg border border-dashed border-line bg-app px-3 py-4 text-center text-[11px] text-muted">No photos yet.</p>'
    }
    <button type="button" data-addimg="${path}" data-ratio="${ratio}" class="btn-ghost mt-2 w-full text-xs">📷 Add photos &amp; crop</button>
  </div>`
}

function listString(path, label, md) {
  const arr = get(path) || []
  return `<div>
    <p class="mb-2 text-xs font-700 uppercase tracking-wider text-muted">${esc(label)}${md ? mdHint({ md: true }) : ''}</p>
    <div class="space-y-2">
      ${arr
        .map(
          (s, i) => `<div class="flex gap-2">
        <input data-path="${path}.${i}" value="${esc(s)}" class="field text-xs"/>
        <button type="button" data-del="${path}.${i}" class="btn-ghost !px-2.5 shrink-0 text-rose-600" title="Remove">✕</button>
      </div>`
        )
        .join('')}
    </div>
    <button type="button" data-add="${path}" class="mt-2 text-xs font-700 text-brand-700 hover:underline">+ Add item</button>
  </div>`
}

// Tabbed sub-editor: one pill per item, only the active item's fields shown.
function listTabs(path, f) {
  const of = f.of
  const arr = get(path) || []
  const active = Math.min(tabs[path] ?? 0, Math.max(0, arr.length - 1))
  tabs[path] = active
  const cur = arr[active]

  const pills = arr
    .map(
      (it, i) => `<button type="button" data-tab="${path}" data-i="${i}"
        class="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-600 transition-colors ${
          i === active ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface text-ink-700 hover:bg-app'
        }">${esc(tabLabel(it, of, i))}</button>`
    )
    .join('')

  return `<div>
    <div class="mb-3 flex items-center justify-between gap-3 border-b border-line pb-2">
      <div class="flex gap-2 overflow-x-auto">${pills || '<span class="text-xs text-muted">None yet.</span>'}</div>
      <button type="button" data-add="${path}" class="shrink-0 text-xs font-700 text-brand-700 hover:underline">+ Add ${esc(of.label)}</button>
    </div>
    ${
      cur
        ? `<div class="space-y-3 rounded-xl border border-line bg-app p-3">
            ${of.fields
              .map((sf) =>
                sf.t === 'list' && sf.of === 'string'
                  ? listString(`${path}.${active}.${sf.k}`, sf.label, sf.md)
                  : field(sf, `${path}.${active}.${sf.k}`)
              )
              .join('')}
            <div class="flex items-center justify-between border-t border-line pt-3">
              <div class="flex gap-1.5">
                <button type="button" data-move="${path}.${active}" data-dir="-1" class="btn-ghost !px-2 !py-1 text-xs" title="Move earlier">↑</button>
                <button type="button" data-move="${path}.${active}" data-dir="1" class="btn-ghost !px-2 !py-1 text-xs" title="Move later">↓</button>
              </div>
              <button type="button" data-del="${path}.${active}" data-confirm="${esc(of.label)}" class="btn-danger !px-2.5 !py-1 text-xs">Delete ${esc(of.label)}</button>
            </div>
          </div>`
        : ''
    }
  </div>`
}

function sectionHtml(sec) {
  let inner
  if (sec.listString) inner = listString(sec.key, sec.label, sec.md)
  else
    inner = sec.fields
      .map((f) => {
        const p = `${sec.key}.${f.k}`
        // A list of plain strings gets the inline row editor; a list of
        // objects gets the tabbed one.
        if (f.t === 'list' && f.of === 'string') return listString(p, f.label || f.k, f.md)
        if (f.t === 'list')
          return `<div><p class="mb-2 text-xs font-700 uppercase tracking-wider text-muted">${esc(f.label || f.k)}</p>${listTabs(p, f)}</div>`
        return field(f, p)
      })
      .join('')
  const id = sectionId(sec)
  return `<details class="card p-5" data-sec="${id}" ${openSections.has(id) ? 'open' : ''}>
    <summary class="flex cursor-pointer select-none items-center justify-between text-base font-700 text-ink">
      <span class="font-display">${esc(sec.label)}</span>
      <span class="rounded border border-line bg-app px-2 py-0.5 text-xs font-600 uppercase text-muted">${esc(sec.key)}</span>
    </summary>
    <div class="mt-4 space-y-4 border-t border-line pt-4">${inner}</div>
  </details>`
}

/* =============================================================
   Live preview — the real page, from the shared renderer.
   Queued images are swapped to their local data URL so photos
   appear before the draft is committed.
   ============================================================= */
function withLocalPreviews(c) {
  if (!Object.keys(previews).length) return c
  const clone = JSON.parse(JSON.stringify(c))
  const swap = (o) => {
    if (Array.isArray(o)) return o.forEach(swap)
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && previews[v]) o[k] = previews[v]
      else swap(v)
    }
  }
  swap(clone)
  return clone
}

let previewTimer = null
function renderLivePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(paintPreview, 90)
}

function paintPreview() {
  const prev = $('cmsLivePreview')
  if (!prev) return
  const top = prev.scrollTop
  const data = withLocalPreviews(content || seed)
  prev.innerHTML = activePage === 'commercial' ? renderCommercialPage(data, { inert: true }) : renderPage(data, { inert: true })
  prev.scrollTop = top
  initCarousels(prev)
  initLightbox()
  const hdr = prev.querySelector('.site-header')
  if (hdr) {
    // On the site the header is fixed and overlays the hero; sticky inside a
    // scrolling pane would instead push the hero down, so its own height is
    // cancelled out.
    hdr.style.marginBottom = `-${hdr.offsetHeight}px`
    const sync = () => hdr.classList.toggle('is-scrolled', prev.scrollTop > 24)
    prev.onscroll = () => {
      paneScrollPreview = prev.scrollTop
      sync()
    }
    sync()
  }
}
let paneScrollPreview = 0

/* =============================================================
   Modals — crop studio + confirm dialog. Mounted on <body> once,
   so re-rendering the editor never destroys them. (The image
   viewer is the shared lightbox component.)
   ============================================================= */
function ensureModals() {
  if ($('cropModal')) return
  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div id="cropModal" hidden class="fixed inset-0 z-[70] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
      <div class="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div class="flex items-center justify-between border-b border-line bg-app px-6 py-4">
          <div>
            <h3 class="font-display text-lg font-700 text-ink">Image Studio: Crop &amp; Adjust</h3>
            <p class="text-xs text-muted">Crop box, aspect ratios, brightness, contrast, rotate &amp; compress.</p>
          </div>
          <div class="flex items-center gap-3">
            <span id="cropQueue" class="text-xs font-600 text-muted"></span>
            <button id="closeCropModal" class="text-lg font-700 text-muted hover:text-ink">✕</button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <!-- min-w-0/min-h-0: a flex item defaults to min-width:auto and would
               otherwise grow to the image's natural width, pushing the crop box
               under the sidebar where its right handle can't be grabbed. -->
          <div id="cropStage" class="flex h-[56vh] min-h-[300px] min-w-0 flex-1 items-center justify-center overflow-hidden bg-slate-950 p-4">
            <img id="cropTargetImg" alt="" class="block max-h-[55vh] max-w-full"/>
          </div>
          <div class="w-full shrink-0 space-y-5 overflow-y-auto border-t border-line bg-surface p-5 md:w-80 md:border-l md:border-t-0">
            <div>
              <label class="mb-2 block text-xs font-700 uppercase tracking-wider text-muted">Aspect Ratio</label>
              <div id="aspectPresets" class="grid grid-cols-4 gap-1.5">
                <button data-ratio="1.7777" class="btn-ghost !px-1.5 !py-1 text-xs">16:9</button>
                <button data-ratio="1.3333" class="btn-ghost !px-1.5 !py-1 text-xs">4:3</button>
                <button data-ratio="1" class="btn-ghost !px-1.5 !py-1 text-xs">1:1</button>
                <button data-ratio="0" class="btn-ghost !px-1.5 !py-1 text-xs">Free</button>
              </div>
              <div id="orientToggle" class="mt-1.5 grid grid-cols-2 gap-1.5">
                <button data-orient="landscape" class="btn-ghost !px-1.5 !py-1 text-xs">▭ Landscape</button>
                <button data-orient="portrait" class="btn-ghost !px-1.5 !py-1 text-xs">▯ Portrait</button>
              </div>
            </div>
            <div>
              <label class="mb-2 block text-xs font-700 uppercase tracking-wider text-muted">Transform</label>
              <div class="flex gap-2">
                <button id="rotateLeftBtn" class="btn-ghost flex-1 text-xs">↺ Rotate Left</button>
                <button id="rotateRightBtn" class="btn-ghost flex-1 text-xs">↻ Rotate Right</button>
              </div>
            </div>
            <div class="space-y-3 border-t border-line pt-3">
              <label class="block text-xs font-700 uppercase tracking-wider text-muted">Image Adjustments</label>
              <div>
                <div class="mb-1 flex justify-between text-xs font-600"><span>Brightness</span><span id="brightnessVal">100%</span></div>
                <input type="range" id="brightnessInp" min="50" max="150" value="100" class="w-full"/>
              </div>
              <div>
                <div class="mb-1 flex justify-between text-xs font-600"><span>Contrast</span><span id="contrastVal">100%</span></div>
                <input type="range" id="contrastInp" min="50" max="150" value="100" class="w-full"/>
              </div>
              <div>
                <div class="mb-1 flex justify-between text-xs font-600"><span>Saturate</span><span id="saturateVal">100%</span></div>
                <input type="range" id="saturateInp" min="0" max="200" value="100" class="w-full"/>
              </div>
              <div>
                <div class="mb-1 flex justify-between text-xs font-600"><span>Blur</span><span id="blurVal">0px</span></div>
                <input type="range" id="blurInp" min="0" max="24" value="0" class="w-full"/>
                <p class="mt-1 text-[11px] leading-snug text-muted">Kept as a live CSS filter, not baked in — ideal for backdrops, and adjustable later.</p>
              </div>
              <button id="resetAdjustmentsBtn" class="block text-xs font-600 text-brand-700 hover:underline">Reset Adjustments</button>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between border-t border-line bg-app px-6 py-4">
          <span class="text-xs text-muted">Output: <strong class="text-ink">optimised JPEG, max 1600px</strong></span>
          <div class="flex gap-2">
            <button id="cancelCropBtn" class="btn-ghost text-xs">Cancel</button>
            <button id="applyCropBtn" class="btn-primary text-xs">Apply &amp; Use Image</button>
          </div>
        </div>
      </div>
    </div>

    <div id="confirmModal" hidden class="fixed inset-0 z-[75] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
      <div class="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <h4 id="confirmTitle" class="font-display text-lg font-700 text-ink">Confirm action</h4>
        <p id="confirmMsg" class="text-sm leading-relaxed text-muted"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button id="confirmCancelBtn" class="btn-ghost text-xs">Cancel</button>
          <button id="confirmOkBtn" class="btn-danger border border-rose-200 bg-rose-50 text-xs">Delete</button>
        </div>
      </div>
    </div>`
  while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild)
  wireCropModal()
}

const show = (id) => $(id).removeAttribute('hidden')
const hide = (id) => $(id).setAttribute('hidden', '')

function confirmDialog(title, msg, onOk) {
  ensureModals()
  $('confirmTitle').textContent = title
  $('confirmMsg').textContent = msg
  show('confirmModal')
  const ok = $('confirmOkBtn')
  const cancel = $('confirmCancelBtn')
  const close = () => {
    hide('confirmModal')
    ok.onclick = null
    cancel.onclick = null
  }
  cancel.onclick = close
  ok.onclick = () => {
    close()
    onOk()
  }
}

/* ---------- crop studio ---------- */
let cropper = null
let cropTarget = null // { path, isNew, name, ratio }
let cropQueue = [] // remaining files from a multi-select
let baseRatio = 0 // the preset, before orientation is applied
let orient = 'landscape'
const adjust = { brightness: 100, contrast: 100, saturate: 100, blur: 0 }
// Brightness/contrast/saturate are baked into the exported file; blur is not —
// it is stored and applied as a CSS filter so it stays adjustable later.
const filterCss = () => `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturate}%)`
const previewFilterCss = () => `${filterCss()} blur(${adjust.blur}px)`
const effectiveRatio = () => (!baseRatio || baseRatio === 1 ? baseRatio : orient === 'portrait' ? 1 / baseRatio : baseRatio)

function pickImage(path, ratio, isNew = false, allowSvg = false) {
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = allowSvg ? 'image/svg+xml,image/*' : 'image/*'
  inp.multiple = isNew // adding to a gallery? take as many as you like
  inp.onchange = () => {
    const files = [...(inp.files || [])]
    if (!files.length) return
    cropQueue = files.slice(1).map((f) => ({ file: f, path, ratio, isNew }))
    openCropper(files[0], path, ratio, isNew)
  }
  inp.click()
}

/**
 * SVGs go up untouched — rasterising a logo would defeat the point. Only a
 * sanity check that we are not committing a scripted document.
 */
function readSvg(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('Could not read file'))
    fr.onload = () => {
      const text = String(fr.result || '')
      if (/<script|\son\w+\s*=/i.test(text)) return reject(new Error('SVG contains script — not uploaded'))
      const slug =
        (file.name || 'logo')
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'logo'
      const path = `public/uploads/${Date.now()}-${slug}.svg`
      const base64 = btoa(unescape(encodeURIComponent(text)))
      resolve({ path, base64, preview: 'data:image/svg+xml;base64,' + base64, url: '/' + path.replace(/^public\//, '') })
    }
    fr.readAsText(file)
  })
}

async function openCropper(file, path, ratio, isNew) {
  ensureModals()

  // Vector logos skip the crop studio entirely.
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
    try {
      await queueUpload(await readSvg(file), path, isNew)
    } catch (e) {
      toast(e.message)
    }
    nextInQueue()
    return
  }

  cropTarget = { path, isNew, name: file.name || 'photo.jpg', ratio }
  baseRatio = Number(ratio) || 0
  orient = 'landscape'
  adjust.brightness = adjust.contrast = adjust.saturate = 100
  adjust.blur = 0
  syncAdjustUi()
  $('cropQueue').textContent = cropQueue.length ? `${cropQueue.length} more queued` : ''

  const fr = new FileReader()
  fr.onload = (e) => {
    const img = $('cropTargetImg')
    if (cropper) {
      cropper.destroy()
      cropper = null
    }
    img.removeAttribute('style')
    img.src = e.target.result
    show('cropModal')
    if (typeof Cropper !== 'function') {
      hide('cropModal')
      commitImage(file, path, isNew)
      return
    }
    // Wait for the bitmap, then size the <img> to fit the stage *exactly*
    // before Cropper measures it. Cropper builds its container from the
    // image's rendered box, so anything larger leaves part of the crop box
    // (and its handles) outside the visible area.
    const start = () => {
      fitCropImage(img)
      cropper = new Cropper(img, {
        aspectRatio: effectiveRatio() || NaN,
        viewMode: 1,
        autoCropArea: 1,
        background: false,
        checkOrientation: true,
      })
      markRatio()
    }
    if (img.complete && img.naturalWidth) requestAnimationFrame(start)
    else img.onload = () => requestAnimationFrame(start)
  }
  fr.readAsDataURL(file)
}

function fitCropImage(img) {
  const stage = $('cropStage').getBoundingClientRect()
  const pad = 32
  const availW = Math.max(120, stage.width - pad)
  const availH = Math.max(120, stage.height - pad)
  const k = Math.min(availW / img.naturalWidth, availH / img.naturalHeight, 1)
  img.style.maxWidth = 'none'
  img.style.maxHeight = 'none'
  img.style.width = Math.round(img.naturalWidth * k) + 'px'
  img.style.height = Math.round(img.naturalHeight * k) + 'px'
}

function markRatio() {
  for (const b of $('aspectPresets').children)
    b.classList.toggle('!border-brand-400', Math.abs(Number(b.dataset.ratio) - baseRatio) < 0.01)
  const free = !baseRatio || baseRatio === 1
  for (const b of $('orientToggle').children) {
    b.classList.toggle('!border-brand-400', !free && b.dataset.orient === orient)
    b.disabled = free
    b.classList.toggle('opacity-40', free)
  }
}

function syncAdjustUi() {
  if (!$('brightnessInp')) return
  $('brightnessInp').value = adjust.brightness
  $('contrastInp').value = adjust.contrast
  $('saturateInp').value = adjust.saturate
  $('blurInp').value = adjust.blur
  $('brightnessVal').textContent = adjust.brightness + '%'
  $('contrastVal').textContent = adjust.contrast + '%'
  $('saturateVal').textContent = adjust.saturate + '%'
  $('blurVal').textContent = adjust.blur + 'px'
  const box = $('cropStage')
  if (box) box.style.filter = previewFilterCss()
}

function closeCropper(clearQueue = true) {
  hide('cropModal')
  if (cropper) cropper.destroy()
  cropper = null
  cropTarget = null
  if (clearQueue) cropQueue = []
}

function nextInQueue() {
  const next = cropQueue.shift()
  if (!next) return false
  openCropper(next.file, next.path, next.ratio, next.isNew)
  return true
}

function wireCropModal() {
  $('closeCropModal').onclick = () => closeCropper()
  $('cancelCropBtn').onclick = () => closeCropper()
  $('rotateLeftBtn').onclick = () => cropper && cropper.rotate(-90)
  $('rotateRightBtn').onclick = () => cropper && cropper.rotate(90)
  $('aspectPresets').onclick = (e) => {
    const b = e.target.closest('[data-ratio]')
    if (!b || !cropper) return
    baseRatio = Number(b.dataset.ratio) || 0
    cropper.setAspectRatio(effectiveRatio() || NaN)
    markRatio()
  }
  $('orientToggle').onclick = (e) => {
    const b = e.target.closest('[data-orient]')
    if (!b || !cropper) return
    orient = b.dataset.orient
    cropper.setAspectRatio(effectiveRatio() || NaN)
    markRatio()
  }
  for (const k of ['brightness', 'contrast', 'saturate', 'blur'])
    $(k + 'Inp').oninput = (e) => {
      adjust[k] = Number(e.target.value)
      syncAdjustUi()
    }
  $('resetAdjustmentsBtn').onclick = () => {
    adjust.brightness = adjust.contrast = adjust.saturate = 100
    adjust.blur = 0
    syncAdjustUi()
  }
  $('applyCropBtn').onclick = async () => {
    if (!cropper || !cropTarget) return
    const { path, isNew, name } = cropTarget
    const src = cropper.getCroppedCanvas({ maxWidth: 2400, maxHeight: 2400, imageSmoothingQuality: 'high' })
    if (!src) return
    const out = document.createElement('canvas')
    out.width = src.width
    out.height = src.height
    const ctx = out.getContext('2d')
    ctx.filter = filterCss()
    ctx.drawImage(src, 0, 0)
    const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.92))
    const blur = adjust.blur
    closeCropper(false)
    await commitImage(new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }), path, isNew, blur)
    nextInQueue()
  }
}

// Puts an already-encoded upload into the pending queue and the content tree.
async function queueUpload(r, path, isNew, blur = 0) {
  pending = pending.filter((p) => p.path !== r.path)
  pending.push({ path: r.path, base64: r.base64 })
  previews[r.url] = r.preview
  if (isNew) {
    const arr = get(path) || []
    arr.push({ src: r.url, alt: '', caption: '', blur })
    set(path, arr)
  } else {
    set(path, r.url)
    // A single-image field keeps its blur alongside, e.g. hero.imageBlur.
    if (path.endsWith('.src')) set(path.replace(/\.src$/, '.blur'), blur)
    else if (blur) set(path + 'Blur', blur)
  }
  toast('Image queued — Save draft to upload')
  renderEditor()
}

// Runs the cropped file through the existing resize + queue pipeline.
async function commitImage(file, path, isNew, blur = 0) {
  try {
    await queueUpload(await ghResizeImage(file), path, isNew, blur)
  } catch (e) {
    toast('Image failed: ' + e.message)
  }
}

/* =============================================================
   Studio shell
   ============================================================= */
function studioHeight() {
  const hdr = document.querySelector('#app header')
  document.documentElement.style.setProperty('--admin-header-h', (hdr ? hdr.offsetHeight : 61) + 'px')
}

// Hand the current, unsaved content to the /draft preview tab.
function openFullPreview() {
  // Queued photos have no file at their /uploads/… URL yet, so hand the
  // preview the inlined data URLs — otherwise it shows the old images.
  const payload = { content: withLocalPreviews(content), savedAt: Date.now() }
  try {
    localStorage.setItem('gnd_preview_content', JSON.stringify(payload))
  } catch (e) {
    // Too many queued images for the storage quota: fall back to the plain
    // content and say so, rather than failing silently.
    try {
      localStorage.setItem('gnd_preview_content', JSON.stringify({ content, savedAt: Date.now() }))
      toast('Preview opened without the queued photos — Save draft first to see them')
    } catch {
      toast('Preview handover failed: ' + e.message)
      return
    }
  }
  window.open('/draft/?source=editor', 'gnd-preview', 'noopener')
}

function renderEditor(v) {
  if (v) host = v
  const el = host
  if (!el) return
  ensureModals()
  studioHeight()
  el.classList.add('cms-view')

  el.innerHTML = `
    <div class="flex h-full flex-col overflow-hidden">
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <h2 class="font-display text-lg font-700 text-ink">Website Editor Studio</h2>
        <span class="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-600 text-brand-700">Pixel-Parity Studio</span>
        <button id="wPreview" type="button"
           class="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-600 text-amber-900 transition hover:bg-amber-200">👁️ Full-page preview ↗</button>
        <span class="text-xs text-muted">@${esc(ghUser() || 'github')}</span>
        <button id="wDisc" class="btn-ghost !px-2.5 !py-1 text-xs">Disconnect</button>
        <span id="wStatus" class="text-xs text-muted"></span>
        <span id="wDeploy" class="flex items-center gap-1.5 rounded-full border border-line bg-app px-2.5 py-1 text-xs"></span>
        <div class="ml-auto flex gap-2">
          <button id="wSave" class="btn-ghost text-xs">Save Draft</button>
          <button id="wPub" class="btn-primary text-xs">Publish to Live</button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <div id="cmsFormPane" class="w-1/2 shrink-0 space-y-4 overflow-y-auto border-r border-line bg-app p-6">
          <div class="flex items-center gap-1 border-b border-line pb-2">
            ${PAGES.map(
              (pg) => `<button type="button" data-page="${pg.id}"
                class="rounded-lg px-3 py-1.5 text-xs font-700 transition-colors ${
                  pg.id === activePage ? 'bg-brand-600 text-white' : 'text-muted hover:bg-app hover:text-ink'
                }">${esc(pg.label)}</button>`
            ).join('')}
            <span class="ml-auto flex items-center gap-1 text-xs font-600 text-emerald-600">
              <span class="h-2 w-2 rounded-full bg-emerald-500"></span> Contextual markdown active
            </span>
          </div>
          <p class="text-xs text-muted">Edits save to <code>content-draft</code>. <span class="font-600">Publish</span> merges to <code>main</code>. Empty sections are dropped from the page.</p>
          <div class="space-y-4">${(PAGES.find((p) => p.id === activePage)?.schema || []).map(sectionHtml).join('')}</div>
        </div>

        <div class="flex w-1/2 flex-col overflow-hidden bg-cream">
          <div class="flex h-10 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 text-xs text-slate-400">
            <span class="font-mono text-[11px] text-slate-300">Live Website Preview</span>
            <span class="rounded border border-brand-500/30 bg-brand-600/30 px-2 py-0.5 text-[10px] font-600 text-brand-300">Same renderer as the build</span>
          </div>
          <div id="cmsLivePreview" class="cms-preview flex-1 overflow-y-auto bg-cream"></div>
        </div>
      </div>
    </div>`

  paintPreview()
  paintDeploy()
  const pane = $('cmsLivePreview')
  if (pane) pane.scrollTop = paneScrollPreview
  wireEditor(el)
  const form = $('cmsFormPane')
  if (form) form.scrollTop = paneScroll
}

function wireEditor(el) {
  const pane = $('cmsFormPane')
  pane.addEventListener('scroll', () => (paneScroll = pane.scrollTop), { passive: true })

  // scalar binding — no re-render, so focus/caret survive typing
  el.querySelectorAll('[data-path]').forEach((inp) =>
    inp.addEventListener('input', () => {
      set(inp.dataset.path, inp.value)
      renderLivePreview()
    })
  )
  // sliders write numbers and update their own read-out in place
  el.querySelectorAll('[data-num]').forEach((inp) =>
    inp.addEventListener('input', () => {
      const n = Number(inp.value) || 0
      set(inp.dataset.num, n)
      const out = inp.nextElementSibling
      if (out) out.textContent = n + 'px'
      renderLivePreview()
    })
  )

  el.querySelectorAll('details[data-sec]').forEach((d) =>
    d.addEventListener('toggle', () => (d.open ? openSections.add(d.dataset.sec) : openSections.delete(d.dataset.sec)))
  )

  pane.addEventListener('click', (e) => {
    const pageBtn = e.target.closest('[data-page]')
    if (pageBtn) {
      e.preventDefault()
      activePage = pageBtn.dataset.page
      paneScroll = 0
      return renderEditor()
    }
    const t = e.target.closest('[data-tab],[data-add],[data-addimg],[data-del],[data-move],[data-crop],[data-clear]')
    if (!t) return
    e.preventDefault()

    if (t.dataset.tab !== undefined && t.dataset.tab !== '') {
      tabs[t.dataset.tab] = Number(t.dataset.i)
      return renderEditor()
    }
    if (t.dataset.crop) return pickImage(t.dataset.crop, Number(t.dataset.ratio) || 0, false, t.dataset.svg === '1')
    if (t.dataset.addimg) return pickImage(t.dataset.addimg, Number(t.dataset.ratio) || 0, true)
    if (t.dataset.clear) {
      set(t.dataset.clear, '')
      return renderEditor()
    }
    if (t.dataset.add) {
      const p = t.dataset.add
      const arr = get(p) || []
      arr.push(blankFor(listDescriptor(p)))
      set(p, arr)
      tabs[p] = arr.length - 1
      return renderEditor()
    }
    if (t.dataset.move) {
      const ks = t.dataset.move.split('.')
      const i = +ks.pop()
      const p = ks.join('.')
      const arr = get(p) || []
      const j = i + Number(t.dataset.dir)
      if (j < 0 || j >= arr.length) return
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      if (tabs[p] === i) tabs[p] = j
      return renderEditor()
    }
    if (t.dataset.del) {
      const ks = t.dataset.del.split('.')
      const i = +ks.pop()
      const p = ks.join('.')
      const drop = () => {
        const arr = get(p) || []
        arr.splice(i, 1)
        if (tabs[p] != null) tabs[p] = Math.max(0, Math.min(tabs[p], arr.length - 1))
        renderEditor()
      }
      if (t.dataset.confirm) confirmDialog(`Delete ${t.dataset.confirm}`, `Remove this ${t.dataset.confirm}? This cannot be undone.`, drop)
      else drop()
    }
  })

  $('wPreview').addEventListener('click', openFullPreview)
  $('wDisc').addEventListener('click', () => {
    ghDisconnect()
    mountWebsite(el)
  })
  $('wSave').addEventListener('click', () => save(false))
  $('wPub').addEventListener('click', () => save(true))
}

/* =============================================================
   Publish state — a strip that says exactly where a publish is:
   saved → merged → building → live (or failed), plus whether the
   draft currently differs from what is live.
   ============================================================= */
const deploy = { phase: 'unknown', detail: '', runUrl: '', sha: '', since: 0 }
let deployTimer = null

const PHASES = {
  unknown: { dot: 'bg-slate-300', text: 'text-muted', label: 'Checking…' },
  clean: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Live is up to date' },
  ahead: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Draft not published' },
  syncing: { dot: 'bg-brand-500 animate-pulse', text: 'text-brand-700', label: 'Syncing with live…' },
  saving: { dot: 'bg-brand-500 animate-pulse', text: 'text-brand-700', label: 'Saving draft…' },
  saved: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Draft saved' },
  publishing: { dot: 'bg-brand-500 animate-pulse', text: 'text-brand-700', label: 'Merging to main…' },
  building: { dot: 'bg-brand-500 animate-pulse', text: 'text-brand-700', label: 'Building…' },
  live: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Published — live' },
  failed: { dot: 'bg-rose-500', text: 'text-rose-700', label: 'Deploy failed' },
}

function setPhase(phase, detail = '', extra = {}) {
  deploy.phase = phase
  deploy.detail = detail
  Object.assign(deploy, extra)
  if (['syncing', 'saving', 'publishing', 'building'].includes(phase) && !deploy.since) deploy.since = Date.now()
  if (['live', 'failed', 'clean', 'ahead', 'saved'].includes(phase)) deploy.since = 0
  paintDeploy()
}

const elapsed = () => {
  if (!deploy.since) return ''
  const s = Math.round((Date.now() - deploy.since) / 1000)
  return s < 60 ? ` · ${s}s` : ` · ${Math.floor(s / 60)}m ${s % 60}s`
}

function paintDeploy() {
  const el = $('wDeploy')
  if (!el) return
  const p = PHASES[deploy.phase] || PHASES.unknown
  el.innerHTML = `<span class="h-2 w-2 shrink-0 rounded-full ${p.dot}"></span>
    <span class="font-600 ${p.text}">${p.label}</span>
    ${deploy.detail ? `<span class="text-muted">${esc(deploy.detail)}${elapsed()}</span>` : `<span class="text-muted">${elapsed()}</span>`}
    ${deploy.runUrl ? `<a href="${esc(deploy.runUrl)}" target="_blank" rel="noopener" class="text-brand-700 underline">build log</a>` : ''}
    ${
      deploy.phase === 'live'
        ? `<a href="https://www.gnd-flooring.com/" target="_blank" rel="noopener" class="text-brand-700 underline">view site</a>`
        : ''
    }`
}

/** Where do things stand right now? Runs on mount and after a publish. */
async function refreshDeployState() {
  const [draft, run] = await Promise.all([ghDraftStatus(), ghDeployStatus().catch(() => null)])
  if (!draft && !run) return setPhase('unknown', 'could not reach GitHub')
  if (run && (run.status === 'in_progress' || run.status === 'queued')) {
    setPhase('building', `main @ ${String(run.sha).slice(0, 7)}`, { runUrl: run.url, since: Date.now() })
    watchDeploy()
    return
  }
  if (draft && draft.ahead > 0) {
    setPhase('ahead', `${draft.ahead} change${draft.ahead === 1 ? '' : 's'} waiting`)
  } else if (run && run.conclusion === 'failure') {
    setPhase('failed', `main @ ${String(run.sha).slice(0, 7)}`, { runUrl: run.url })
  } else {
    setPhase('clean', run ? `main @ ${String(run.sha).slice(0, 7)}` : '')
  }
}

/** Poll the deploy run until it settles, keeping the strip current. */
function watchDeploy() {
  clearInterval(deployTimer)
  const started = Date.now()
  deployTimer = setInterval(async () => {
    paintDeploy() // keep the elapsed clock moving
    if (Date.now() - started > 10 * 60 * 1000) {
      clearInterval(deployTimer)
      setPhase('unknown', 'still building — check the log')
      return
    }
    let run = null
    try {
      run = await ghDeployStatus()
    } catch {
      return
    }
    if (!run) return
    deploy.runUrl = run.url
    if (run.status !== 'completed') {
      setPhase('building', `main @ ${String(run.sha).slice(0, 7)}`, { runUrl: run.url })
      return
    }
    clearInterval(deployTimer)
    if (run.conclusion === 'success') setPhase('live', `main @ ${String(run.sha).slice(0, 7)}`, { runUrl: run.url })
    else setPhase('failed', `${run.conclusion} · main @ ${String(run.sha).slice(0, 7)}`, { runUrl: run.url })
  }, 6000)
}

/* =============================================================
   Save / publish
   ============================================================= */
async function save(publish) {
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
    if (publish) {
      // Pull first: replay the draft on top of live so the merge that follows
      // is a fast-forward rather than a conflict.
      setPhase('syncing')
      const sync = await ghSyncDraft({ siteObj: content })
      if (sync.action === 'rebased') toast(`Draft replayed on live (was ${sync.behind} behind)`)
      else if (sync.action === 'fast-forward') toast('Draft brought up to date with live')
      else if (sync.action === 'failed') toast('Could not sync with live — publishing anyway')
    }
    setPhase('saving')
    await ghCommitDraft(content, pending, publish ? 'Site content (pre-publish)' : 'Update site content')
    pending = []
    if (!publish) {
      btn.textContent = 'Saved ✓'
      st.textContent = ''
      setPhase('saved', 'not published yet')
      refreshDeployState()
    } else {
      setPhase('publishing')
      await ghPublish('Publish site content')
      btn.textContent = 'Published ✓'
      st.textContent = ''
      setPhase('building', 'merged to main', { since: Date.now() })
      watchDeploy()
    }
  } catch (e) {
    st.textContent = ''
    setPhase('failed', e.message.slice(0, 80))
    toast((publish ? 'Publish' : 'Save') + ' failed: ' + e.message)
  } finally {
    setTimeout(() => {
      sBtn.disabled = pBtn.disabled = false
      btn.textContent = orig
    }, 1200)
    busy = false
  }
}

/* =============================================================
   Mount
   ============================================================= */
export async function mountWebsite(v) {
  host = v
  v.classList.remove('cms-view')

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
    // A draft left behind by deploys or another machine is brought forward
    // before anything is read, so edits start from what is live.
    const sync = await ghSyncDraft()
    if (sync.action === 'fast-forward') toast(`Draft synced with live (was ${sync.behind} behind)`)
    content = migrate((await ghLoadSiteJson()) || JSON.parse(JSON.stringify(seed)))
  } catch (e) {
    content = migrate(JSON.parse(JSON.stringify(seed)))
    toast('Loaded local default (' + e.message + ')')
  }
  pending = []
  paneScroll = 0
  paneScrollPreview = 0
  renderEditor(v)
  refreshDeployState()
}

window.addEventListener('resize', () => {
  if (host && host.classList.contains('cms-view')) studioHeight()
})
