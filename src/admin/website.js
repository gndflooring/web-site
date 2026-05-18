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
    <summary class="cursor-pointer select-none text-lg font-700">${esc(sec.label)}</summary>
    <div class="mt-4 space-y-4">${inner}</div>
  </details>`
}

function renderEditor(v) {
  v.innerHTML = `
    <div class="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
      <div class="text-sm">
        <span class="font-700">Connected:</span>
        <span class="text-muted">@${esc(ghUser() || 'github')}</span>
      </div>
      <button id="wDisc" class="btn-ghost">Disconnect</button>
      <span id="wStatus" class="text-sm text-muted"></span>
      <div class="ml-auto flex gap-2">
        <button id="wSave" class="btn-ghost">Save draft</button>
        <button id="wPub" class="btn-primary">Publish</button>
      </div>
    </div>
    <p class="mb-4 text-sm text-muted">Edits are saved to the <code>content-draft</code> branch. <span class="font-600">Publish</span> merges it into <code>main</code>; the site rebuilds and goes live in ~1–2 min.</p>
    <div class="space-y-4">${SCHEMA.map(sectionHtml).join('')}</div>`

  // scalar binding (no re-render → keeps focus while typing)
  v.querySelectorAll('[data-path]').forEach((el) =>
    el.addEventListener('input', () => set(el.dataset.path, el.value))
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
