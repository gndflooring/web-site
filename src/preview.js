// Full-page preview (/draft). Renders the real site client-side from a
// choice of content sources, using the same src/content/render.js the build
// uses — so this is a faithful preview of what would deploy, reviewable
// locally before anything is pushed.
//
//   editor  — the studio's current, unsaved state (handed over in localStorage)
//   draft   — site.json on the content-draft branch
//   main    — site.json on main (what is live)
//   bundled — the copy compiled into this build
import './style.css'
import './preview.css'
import bundled from './content/site.json'
import { renderPage } from './content/render.js'
import { initSiteUi } from './site-ui.js'

const REPO = __GITHUB_REPO__ || 'gndflooring/web-site'
const PATH = 'src/content/site.json'
const EDITOR_KEY = 'gnd_preview_content'

const SOURCES = [
  { id: 'editor', label: 'Editor (unsaved)' },
  { id: 'draft', label: 'Draft branch' },
  { id: 'main', label: 'Main (live)' },
  { id: 'bundled', label: 'This build' },
]

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
let source = params.get('source') || (localStorage.getItem(EDITOR_KEY) ? 'editor' : 'bundled')

function status(msg, tone = '') {
  const el = $('pvStatus')
  el.textContent = msg
  el.className = 'pv-status' + (tone ? ' pv-status--' + tone : '')
}

function drawSources() {
  $('pvSources').innerHTML = SOURCES.map(
    (s) =>
      `<button class="pv-src${s.id === source ? ' is-active' : ''}" type="button" data-src="${s.id}">${s.label}</button>`
  ).join('')
}

/** Branch content, via the raw CDN first and the API (with the admin's token) as a fallback. */
async function fetchBranch(branch) {
  const bust = `?t=${Date.now()}`
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${branch}/${PATH}${bust}`, { cache: 'no-store' })
    if (r.ok) return await r.json()
    if (r.status !== 404) throw new Error(`HTTP ${r.status}`)
  } catch {
    /* fall through to the API */
  }
  const token = sessionStorage.getItem('gnd_gh_token')
  const headers = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${branch}`, { headers, cache: 'no-store' })
  if (!r.ok) {
    throw new Error(
      r.status === 404
        ? `no ${PATH} on ${branch}`
        : r.status === 401 || r.status === 403
          ? 'not authorised — open this from the admin after connecting GitHub'
          : `GitHub ${r.status}`
    )
  }
  const j = await r.json()
  return JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g, '')))))
}

async function load(id) {
  if (id === 'bundled') return { content: bundled, note: 'bundled with this build' }
  if (id === 'editor') {
    const raw = localStorage.getItem(EDITOR_KEY)
    if (!raw) throw new Error('no editor state — open the preview from the CMS studio')
    const { content, savedAt } = JSON.parse(raw)
    return { content, note: savedAt ? `handed over ${new Date(savedAt).toLocaleTimeString()}` : 'from the editor' }
  }
  const branch = id === 'draft' ? 'content-draft' : 'main'
  return { content: await fetchBranch(branch), note: `${branch} @ ${new Date().toLocaleTimeString()}` }
}

async function render() {
  drawSources()
  status('Loading…')
  const page = $('page')
  try {
    const { content, note } = await load(source)
    page.innerHTML = renderPage(content, { inert: true })
    initSiteUi(page)
    // A preview must never submit the quote form.
    page.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()))
    status(note, 'ok')
    const url = new URL(location.href)
    url.searchParams.set('source', source)
    history.replaceState(null, '', url)
  } catch (e) {
    page.innerHTML = `<div class="pv-error"><p class="pv-error-title">Could not load “${source}”</p><p>${e.message}</p></div>`
    status('failed', 'bad')
  }
}

$('pvSources').addEventListener('click', (e) => {
  const b = e.target.closest('[data-src]')
  if (!b) return
  source = b.dataset.src
  render()
})
$('pvReload').addEventListener('click', render)

render()
