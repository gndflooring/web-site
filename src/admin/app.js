import './admin.css'
import { CLIENT_ID, SPREADSHEET_ID, PIPELINE, APPT_TYPES, TAG_PALETTE } from './config.js'
import { signIn, signOut, resume, getEmail } from './auth.js'
import {
  ensureTabs,
  loadAll,
  saveTracking,
  addAppointment,
  updateAppointment,
  deleteAppointment,
  addTask,
  setTaskDone,
  addSnooze,
  addNote,
  updateNote,
  deleteNote,
  addAddress,
  upsertTag,
  deleteTag,
} from './sheets.js'
import { computeNeedsAction, severityByLead } from './heuristics.js'
import { mountWebsite } from './website.js'

const $ = (id) => document.getElementById(id)
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const stCls = (s) => 'st-' + String(s || 'New').replace(/\s+/g, '')
const fmtDT = (v) => {
  const d = new Date(v)
  return isNaN(d) ? esc(v || '—') : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
const fmtD = (v) => {
  const d = new Date(v)
  return isNaN(d) ? esc(v || '—') : d.toLocaleDateString([], { dateStyle: 'medium' })
}
const badge = (s) => `<span class="badge ${stCls(s)}"><span class="dot"></span>${esc(s || 'New')}</span>`
const TITLES = { dashboard: 'Dashboard', board: 'Pipeline Board', leads: 'Leads', calendar: 'Calendar', todo: 'To-Do', notes: 'Notes', settings: 'Settings', website: 'Website' }

let state = null
let items = []
let view = 'dashboard'
let calCursor = new Date()
let calMode = 'month' // 'day' | 'week' | 'month' | 'list'
let wired = false
const collapsedCols = new Set()
const savingLeads = new Set()
const selectedLeads = new Set()
const leadTitle = (lead, track) =>
  ((track && track.title) || '').trim() ||
  `${lead.name || 'Lead'}${lead.service ? ' — ' + lead.service : ''}`

/* ---------- Tags: colours & pills ---------- */
const splitTags = (csv) =>
  String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const tagColor = (name) =>
  (state?.tagColors && state.tagColors[String(name).trim().toLowerCase()]) || ''
function tagText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#15212b'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#15212b' : '#ffffff'
}
const pillStyle = (c) =>
  c ? `style="background:${c};color:${tagText(c)}"` : 'style="background:#eef0f3;color:#2b3a45"'
const tagPills = (csv) =>
  splitTags(csv)
    .map(
      (t) =>
        `<span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-600" ${pillStyle(tagColor(t))}>${esc(t)}</span>`
    )
    .join(' ')
function allKnownTags() {
  const set = new Set()
  ;(state?.tagRows || []).forEach((r) => r.tag && set.add(String(r.tag).trim()))
  ;(state?.tracking || []).forEach((t) => splitTags(t.tags).forEach((x) => set.add(x)))
  ;(state?.notes || []).forEach((n) => splitTags(n.tags).forEach((x) => set.add(x)))
  return [...set].sort((a, b) => a.localeCompare(b))
}
// Interactive tag editor — keeps a hidden CSV input (#id) in sync; pills carry
// a colour-swatch button (native colour picker; dashed when no colour set).
function tagEditorHtml(id, csv) {
  return `<input type="hidden" id="${id}" value="${esc(splitTags(csv).join(', '))}"/>
    <div class="mt-1 rounded-lg border border-line bg-surface p-2">
      <div id="${id}_pills" class="flex flex-wrap items-center gap-1.5"></div>
      <div class="mt-2 flex gap-2">
        <input id="${id}_in" list="${id}_dl" class="field !py-1.5 text-sm" placeholder="add tag…"/>
        <datalist id="${id}_dl">${allKnownTags().map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <button id="${id}_add" type="button" class="btn-ghost shrink-0">Add</button>
      </div>
      <input type="color" id="${id}_color" class="sr-only" tabindex="-1" aria-hidden="true"/>
    </div>`
}
function wireTagEditor(id) {
  const hidden = $(id)
  const pills = $(id + '_pills')
  const inp = $(id + '_in')
  const colorIn = $(id + '_color')
  const get = () => splitTags(hidden.value)
  const setArr = (arr) => {
    hidden.value = arr.join(', ')
    render()
  }
  function render() {
    pills.innerHTML =
      get()
        .map((t) => {
          const c = tagColor(t)
          return `<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-600" ${pillStyle(c)}>
            <button type="button" data-sw="${esc(t)}" title="Set colour" class="h-3.5 w-3.5 rounded-full ${c ? '' : 'border border-dashed'}" style="${c ? `background:${tagText(c)};opacity:.7` : 'border-color:currentColor'}"></button>
            ${esc(t)}
            <button type="button" data-rm="${esc(t)}" class="-mr-1 px-1 opacity-70 hover:opacity-100">×</button>
          </span>`
        })
        .join('') || '<span class="text-xs text-muted">No tags yet</span>'
    pills.querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => setArr(get().filter((x) => x !== b.dataset.rm)))
    )
    pills.querySelectorAll('[data-sw]').forEach((b) =>
      b.addEventListener('click', () => {
        colorIn.dataset.tag = b.dataset.sw
        colorIn.value = tagColor(b.dataset.sw) || '#2f7cb5'
        colorIn.click()
      })
    )
  }
  const add = () => {
    const v = inp.value.trim()
    if (!v) return
    const a = get()
    if (!a.some((x) => x.toLowerCase() === v.toLowerCase())) a.push(v)
    inp.value = ''
    setArr(a)
  }
  $(id + '_add').addEventListener('click', add)
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  })
  colorIn.addEventListener('change', async () => {
    const t = colorIn.dataset.tag
    const c = colorIn.value
    if (!t) return
    state.tagColors[t.trim().toLowerCase()] = c
    render()
    try {
      await upsertTag(t, c)
    } catch (e) {
      toast('Colour save failed: ' + e.message)
    }
  })
  render()
}

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.style.opacity = '1'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => (t.style.opacity = '0'), 2600)
}

/* ---------- Auth ---------- */
function configError() {
  if (!CLIENT_ID || !SPREADSHEET_ID) {
    $('cfgMsg').textContent =
      'Admin not configured yet: GOOGLE_OAUTH_CLIENT_ID / SHEETS_SPREADSHEET_ID are unset.'
    $('signInBtn').disabled = true
    return true
  }
  return false
}
async function start() {
  if (configError()) return
  try {
    if (await resume()) return enterApp()
  } catch {
    /* show sign-in */
  }
}
$('signInBtn').addEventListener('click', async () => {
  $('signinMsg').textContent = ''
  $('signInBtn').disabled = true
  try {
    await signIn()
    await enterApp()
  } catch (e) {
    $('signinMsg').textContent = e.code === 'UNAUTHORIZED' ? e.message : `Sign-in failed: ${e.message}`
  } finally {
    $('signInBtn').disabled = false
  }
})

function wireOnce() {
  if (wired) return
  wired = true
  $('signOutBtn').addEventListener('click', () => {
    signOut()
    location.reload()
  })
  $('refreshBtn').addEventListener('click', () => reload(true))
  $('menuBtn').addEventListener('click', () =>
    $('sidebar').classList.toggle('-translate-x-full')
  )
  $('nav').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-view]')
    if (!a) return
    view = a.dataset.view
    if (window.innerWidth < 1024) $('sidebar').classList.add('-translate-x-full')
    render()
  })
  $('search').addEventListener('input', applySearch)
  $('drawerBackdrop').addEventListener('click', closeDrawer)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerStack.length) popPanel()
  })
  $('drawerBody').addEventListener('click', (e) => {
    if (e.target.closest('[data-drawer-back]')) popPanel()
    else if (e.target.closest('[data-drawer-close]')) closeDrawer()
  })
}

async function enterApp() {
  $('signin').hidden = true
  $('app').hidden = false
  wireOnce()
  $('userEmail').textContent = getEmail() || ''
  await reload(false)
}

async function reload(notify) {
  if (!state) $('view').innerHTML = skeleton() // skeleton only on first load, no flash on refresh
  try {
    await ensureTabs()
    state = await loadAll()
    items = computeNeedsAction(state)
    render()
    if (notify) toast('Refreshed')
  } catch (e) {
    $('view').innerHTML = `<div class="card mx-auto max-w-lg p-8 text-center">
      <p class="font-700 text-rose-600">Could not load data</p>
      <p class="mt-2 text-sm text-muted">${esc(e.message)}</p>
      <p class="mt-4 text-xs text-muted">Check the spreadsheet is shared with your account and the Sheets API is enabled.</p></div>`
  }
}
const skeleton = () =>
  `<div class="grid gap-4 sm:grid-cols-4">${'<div class="card h-24 animate-pulse"></div>'.repeat(
    4
  )}</div><div class="card mt-4 h-72 animate-pulse"></div>`

/* ---------- Duration combo & time picker ---------- */
const DUR_PRESETS = [15, 30, 45, 60, 90]
function durationFieldHtml(id, val) {
  const v = Number(val) || 60
  const preset = DUR_PRESETS.includes(v)
  return `<input type="hidden" id="${id}" value="${v}"/>
    <div class="mt-1 flex gap-2">
      <select id="${id}_sel" class="field">
        ${DUR_PRESETS.map((p) => `<option value="${p}" ${preset && p === v ? 'selected' : ''}>${p} min</option>`).join('')}
        <option value="custom" ${preset ? '' : 'selected'}>Custom…</option>
      </select>
      <input id="${id}_custom" type="number" min="5" step="5" value="${v}" class="field !w-24 ${preset ? 'hidden' : ''}" aria-label="Custom minutes"/>
    </div>`
}
function wireDuration(id) {
  const hid = $(id)
  const sel = $(id + '_sel')
  const cust = $(id + '_custom')
  const sync = () => {
    if (sel.value === 'custom') {
      cust.classList.remove('hidden')
      hid.value = Number(cust.value) || 60
    } else {
      cust.classList.add('hidden')
      hid.value = sel.value
    }
  }
  sel.addEventListener('change', sync)
  cust.addEventListener('input', () => {
    if (sel.value === 'custom') hid.value = Number(cust.value) || 60
  })
  sync()
}
const fmt12 = (t) => {
  const [h, m] = String(t).split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 || 12
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`
}
function timeOptions() {
  const o = []
  for (let h = 6; h <= 20; h++)
    for (const m of [0, 15, 30, 45]) o.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  return o
}
function timeFieldHtml(id, val) {
  const v = val || '09:00'
  const opts = timeOptions()
  const known = opts.includes(v)
  return `<input type="hidden" id="${id}" value="${v}"/>
    <div class="mt-1 flex gap-2">
      <select id="${id}_sel" class="field">
        ${opts.map((t) => `<option value="${t}" ${known && t === v ? 'selected' : ''}>${fmt12(t)}</option>`).join('')}
        <option value="other" ${known ? '' : 'selected'}>Other…</option>
      </select>
      <input id="${id}_other" type="time" value="${v}" class="field !w-32 ${known ? 'hidden' : ''}" aria-label="Custom time"/>
    </div>`
}
function wireTime(id) {
  const hid = $(id)
  const sel = $(id + '_sel')
  const oth = $(id + '_other')
  const sync = () => {
    if (sel.value === 'other') {
      oth.classList.remove('hidden')
      hid.value = oth.value || '09:00'
    } else {
      oth.classList.add('hidden')
      hid.value = sel.value
    }
  }
  sel.addEventListener('change', sync)
  oth.addEventListener('input', () => {
    if (sel.value === 'other') hid.value = oth.value
  })
  sync()
}

/* ---------- Drawer: generic back-stack ---------- */
let drawerStack = []
function renderDrawer() {
  if (!drawerStack.length) {
    $('drawer').classList.remove('open')
    $('drawerBackdrop').classList.remove('open')
    return
  }
  $('drawer').classList.add('open')
  $('drawerBackdrop').classList.add('open')
  drawerStack[drawerStack.length - 1]()
}
function pushPanel(fn) {
  drawerStack.push(fn)
  renderDrawer()
}
function popPanel() {
  drawerStack.pop()
  renderDrawer()
}
function refreshDrawer() {
  if (drawerStack.length) renderDrawer()
}
function closeDrawer() {
  drawerStack = []
  $('drawer').classList.remove('open')
  $('drawerBackdrop').classList.remove('open')
}
const setDrawerBody = (html) => ($('drawerBody').innerHTML = html)

// Standard panel header with ‹ Back (when deeper than 1) and ✕ (close all).
function drawerHeader(titleHtml, subHtml) {
  const back =
    drawerStack.length > 1
      ? `<button data-drawer-back class="btn-ghost !px-2" aria-label="Back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>`
      : ''
  return `<header class="flex items-start gap-3 border-b border-line p-5">
    ${back}
    <div class="min-w-0 flex-1">${titleHtml}${subHtml ? `<p class="text-sm text-muted">${subHtml}</p>` : ''}</div>
    <button data-drawer-close class="btn-ghost !px-2" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
  </header>`
}

// Button "Saving…" → "Saved ✓" feedback; disables to block double-submit.
async function withSaving(btn, fn, savedLabel = 'Saved ✓') {
  if (!btn) return fn()
  const orig = btn.textContent
  btn.disabled = true
  btn.textContent = 'Saving…'
  try {
    const r = await fn()
    btn.textContent = savedLabel
    await new Promise((res) => setTimeout(res, 450))
    return r
  } catch (e) {
    btn.disabled = false
    btn.textContent = orig
    toast(e?.message ? `Failed: ${e.message}` : 'Save failed')
    throw e
  }
}

/* ---------- Router ---------- */
function applySearch() {
  if (view !== 'leads') return
  const term = $('search').value.toLowerCase()
  const rows = document.getElementById('rows')
  if (!rows) return
  for (const tr of rows.children) tr.hidden = term && !tr.dataset.s.includes(term)
}
function render() {
  for (const a of $('nav').querySelectorAll('a[data-view]'))
    a.classList.toggle('active', a.dataset.view === view)
  $('pageTitle').textContent = TITLES[view]
  $('search').classList.toggle('hidden', view !== 'leads')
  $('search').classList.toggle('sm:block', view === 'leads')
  if (!state) return
  const v = $('view')
  if (view === 'dashboard') dashboard(v)
  else if (view === 'board') board(v)
  else if (view === 'leads') leads(v)
  else if (view === 'calendar') calendar(v)
  else if (view === 'todo') todo(v)
  else if (view === 'notes') notesView(v)
  else if (view === 'settings') settingsView(v)
  else if (view === 'website') mountWebsite(v)
}

const sevColor = { urgent: 'bg-rose-500', due: 'bg-amber-500', normal: 'bg-slate-300' }
const leadName = (id) => state.records.find((r) => r.lead.id === id)?.lead.name || ''

/* ---------- Dashboard ---------- */
function dashboard(v) {
  const now = Date.now()
  const urgent = items.filter((i) => i.severity === 'urgent').length
  const upcoming = state.schedule.filter((a) => {
    const t = new Date(a.start).getTime()
    return !isNaN(t) && t > now && t < now + 7 * 864e5
  })
  const openTasks = state.tasks.filter((t) => String(t.done).toUpperCase() !== 'TRUE')
  const byStatus = {}
  PIPELINE.forEach((s) => (byStatus[s] = 0))
  state.records.forEach((r) => {
    const s = r.track?.status && PIPELINE.includes(r.track.status) ? r.track.status : 'New'
    byStatus[s]++
  })
  const recent = [...state.activity]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 7)

  const tile = (n, label, accent) =>
    `<div class="card p-5"><p class="text-3xl font-700 ${accent || ''}">${n}</p><p class="mt-1 text-sm text-muted">${label}</p></div>`

  v.innerHTML = `
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${tile(state.records.length, 'Total leads')}
      ${tile(items.length, 'Needs action', items.length ? 'text-amber-600' : '')}
      ${tile(urgent, 'Urgent', urgent ? 'text-rose-600' : '')}
      ${tile(upcoming.length, 'Upcoming (7d)')}
    </div>

    <div class="mt-4 card p-5">
      <p class="text-xs font-700 uppercase tracking-wider text-muted">Pipeline</p>
      <div class="mt-3 flex flex-wrap gap-2">
        ${PIPELINE.map((s) => `<span class="badge ${stCls(s)}">${esc(s)} · ${byStatus[s]}</span>`).join('')}
      </div>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-3">
      <section class="card p-6 lg:col-span-2">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-700">Needs action</h2>
          <button class="text-sm font-600 text-brand-700" data-go="todo">View all →</button>
        </div>
        <ul class="mt-4 space-y-2">
          ${
            items.slice(0, 8).map((it) => `
            <li class="flex items-center gap-3 rounded-xl border border-line p-3 sla-${it.severity} ${
              it.leadId ? 'cursor-pointer hover:bg-app' : ''
            }" ${it.leadId ? `data-lead="${esc(it.leadId)}"` : ''}>
              <span class="h-2 w-2 shrink-0 rounded-full ${sevColor[it.severity]}"></span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-600">${esc(it.title)}</p>
                <p class="truncate text-xs text-muted">${esc(it.detail)}</p>
              </div>
            </li>`).join('') ||
            '<li class="rounded-xl bg-app p-6 text-center text-sm text-muted">All clear 🎉</li>'
          }
        </ul>
      </section>
      <div class="space-y-4">
        <section class="card p-6">
          <h2 class="text-lg font-700">Next 7 days</h2>
          <ul class="mt-3 space-y-2 text-sm">
            ${
              upcoming
                .sort((a, b) => new Date(a.start) - new Date(b.start))
                .slice(0, 6)
                .map((a) => `<li class="flex justify-between gap-2"><span class="truncate">${esc(a.type)} · ${esc(
                  leadName(a.lead_id) || a.notes || ''
                )}</span><span class="shrink-0 text-muted">${fmtDT(a.start)}</span></li>`)
                .join('') || '<li class="text-muted">Nothing scheduled</li>'
            }
          </ul>
          <button class="mt-3 text-sm font-600 text-brand-700" data-go="calendar">Open calendar →</button>
        </section>
        <section class="card p-6">
          <h2 class="text-lg font-700">Recent activity</h2>
          <ul class="mt-3 space-y-2 text-xs text-muted">
            ${
              recent
                .map(
                  (a) =>
                    `<li><span class="font-600 text-ink-700">${esc(a.action)}</span> — ${esc(
                      leadName(a.id) || a.id
                    )} <span class="text-muted">· ${fmtDT(a.timestamp)}</span></li>`
                )
                .join('') || '<li>No activity yet</li>'
            }
          </ul>
        </section>
      </div>
    </div>`
  v.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.go
      render()
    })
  )
  v.querySelectorAll('[data-lead]').forEach((li) =>
    li.addEventListener('click', () => openLead(li.dataset.lead))
  )
}

/* ---------- Board ---------- */
function cardHtml(r, sev) {
  return `<div class="card cursor-grab p-3 sla-${sev[r.lead.id] || 'normal'}" draggable="true" data-id="${esc(
    r.lead.id
  )}">
    <p class="text-sm font-700">${esc(r.lead.name || 'Lead')}</p>
    <p class="truncate text-xs text-muted">${esc(r.lead.service || '')}</p>
    ${r.track?.tags ? `<div class="mt-1.5 flex flex-wrap gap-1">${tagPills(r.track.tags)}</div>` : ''}
  </div>`
}

function board(v) {
  const sev = severityByLead(items)
  const cols = {}
  PIPELINE.forEach((s) => (cols[s] = []))
  state.records.forEach((r) => {
    const s = r.track?.status && PIPELINE.includes(r.track.status) ? r.track.status : 'New'
    cols[s].push(r)
  })

  const column = (s) => {
    const n = cols[s].length
    if (collapsedCols.has(s)) {
      return `<div class="js-drop flex w-12 shrink-0 cursor-pointer flex-col items-center gap-3 rounded-xl bg-black/[0.03] py-3" data-col="${esc(
        s
      )}" data-collapsed="1" title="Expand ${esc(s)}">
        <span class="text-muted"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
        <span class="badge ${stCls(s)}">${n}</span>
        <span class="mt-1 rotate-180 text-xs font-700 text-muted [writing-mode:vertical-rl]">${esc(s)}</span>
      </div>`
    }
    return `<div class="kanban-col">
      <div class="mb-2 flex items-center justify-between gap-2 px-1">
        <span class="badge ${stCls(s)}">${esc(s)}</span>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-600 text-muted">${n}</span>
          <button class="js-collapse rounded p-0.5 text-muted hover:bg-black/5 hover:text-ink" data-col="${esc(
            s
          )}" aria-label="Collapse ${esc(s)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        </div>
      </div>
      <div class="js-drop col-drop space-y-2 rounded-xl bg-black/[0.03] p-2" data-col="${esc(s)}" style="min-height:140px">
        ${cols[s].map((r) => cardHtml(r, sev)).join('')}
      </div>
    </div>`
  }

  const prevScroll = document.getElementById('boardScroll')?.scrollLeft || 0
  v.innerHTML = `
    <p class="mb-4 text-sm text-muted">Drag a card between columns to change status · click a card for details · use the arrow to collapse a column.</p>
    <div id="boardScroll" class="flex gap-4 overflow-x-auto pb-4">
      ${PIPELINE.map(column).join('')}
    </div>`
  const scroller = document.getElementById('boardScroll')
  if (scroller) scroller.scrollLeft = prevScroll

  const toggle = (s, collapse) => {
    collapse ? collapsedCols.add(s) : collapsedCols.delete(s)
    board(v)
  }
  v.querySelectorAll('.js-collapse').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      toggle(b.dataset.col, true)
    })
  )
  v.querySelectorAll('[data-collapsed]').forEach((el) =>
    el.addEventListener('click', () => toggle(el.dataset.col, false))
  )

  let dragId = null
  let dragging = false
  v.querySelectorAll('[draggable=true]').forEach((c) => {
    c.addEventListener('dragstart', () => {
      dragId = c.dataset.id
      dragging = true
    })
    c.addEventListener('dragend', () => setTimeout(() => (dragging = false), 60))
    c.addEventListener('click', () => {
      if (!dragging) openLead(c.dataset.id)
    })
  })
  v.querySelectorAll('.js-drop').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault()
      col.classList.add('drag-over')
    })
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'))
    col.addEventListener('drop', (e) => {
      e.preventDefault()
      col.classList.remove('drag-over')
      moveCard(dragId, col.dataset.col)
    })
  })
}

// Optimistic status move: mutate local state + re-render the board instantly
// (no skeleton, no network on the visible path, scroll preserved), persist in
// the background, then quietly resync. Reverts on failure.
async function moveCard(leadId, ns) {
  const rec = state.records.find((r) => r.lead.id === leadId)
  if (!rec || !ns) return
  const prevStatus = rec.track?.status || 'New'
  if (prevStatus === ns || savingLeads.has(leadId)) return
  savingLeads.add(leadId)

  const prevSnap = rec.track ? { ...rec.track } : null
  if (rec.track) {
    rec.track.status = ns
  } else {
    rec.track = { id: leadId, status: ns, tags: '', notes: '', updated_at: '', updated_by: '' }
    state.tracking.push(rec.track)
    state.trackMap[leadId] = rec.track
  }
  items = computeNeedsAction(state)
  if (view === 'board') board($('view'))
  toast(`Moved to ${ns}`)

  try {
    await saveTracking(leadId, { status: ns }, getEmail(), prevSnap)
    state = await loadAll() // silent resync (refreshes row indices); no re-render
    items = computeNeedsAction(state)
  } catch (e) {
    toast('Save failed: ' + e.message)
    try {
      state = await loadAll()
      items = computeNeedsAction(state)
    } catch {
      /* keep optimistic state */
    }
    if (view === 'board') board($('view'))
  } finally {
    savingLeads.delete(leadId)
  }
}

/* ---------- Leads table ---------- */
function tagPool() {
  const set = new Set()
  state.tracking.forEach((t) =>
    String(t.tags || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => set.add(x))
  )
  return [...set]
}
function leads(v) {
  const rows = [...state.records].sort(
    (a, b) =>
      new Date(b.lead.submittedAt || b.lead.timestamp) -
      new Date(a.lead.submittedAt || a.lead.timestamp)
  )
  const present = new Set(rows.map((r) => r.lead.id))
  ;[...selectedLeads].forEach((id) => present.has(id) || selectedLeads.delete(id))

  v.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <span class="text-sm text-muted">${rows.length} lead${rows.length === 1 ? '' : 's'}</span>
      <span id="selCount" class="text-sm font-600 text-brand-700"></span>
      <div class="ml-auto flex gap-2">
        <button id="printBtn" class="btn-primary" disabled>Print Visits PDF</button>
        <button id="csv" class="btn-ghost">Export CSV</button>
      </div>
    </div>
    <div class="card overflow-hidden">
      <div class="max-h-[calc(100vh-200px)] overflow-auto">
        <table class="tbl">
          <thead><tr>
            <th class="w-10"><input type="checkbox" id="selAll" class="h-4 w-4 accent-brand-600" aria-label="Select all"/></th>
            <th>Title</th><th>Status</th><th>Tags</th><th>Received</th><th></th>
          </tr></thead>
          <tbody id="rows">
            ${
              rows
                .map(({ lead, track }) => {
                  const t = leadTitle(lead, track)
                  const s = [t, lead.name, lead.email, lead.phone, lead.service, lead.message, track?.tags]
                    .join(' ')
                    .toLowerCase()
                  return `<tr data-id="${esc(lead.id)}" data-s="${esc(s)}">
                  <td><input type="checkbox" class="sel h-4 w-4 accent-brand-600" data-id="${esc(lead.id)}" ${
                    selectedLeads.has(lead.id) ? 'checked' : ''
                  }/></td>
                  <td><p class="font-700">${esc(t)}</p><p class="text-xs text-muted">${esc(lead.email || '')}</p></td>
                  <td>${badge(track?.status || 'New')}</td>
                  <td class="max-w-[200px]"><div class="flex flex-wrap gap-1">${tagPills(track?.tags)}</div></td>
                  <td class="whitespace-nowrap text-xs text-muted">${fmtDT(lead.submittedAt || lead.timestamp)}</td>
                  <td class="text-muted"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></td>
                </tr>`
                })
                .join('') ||
              '<tr><td colspan="6" class="p-10 text-center text-muted">No leads yet</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`

  const visibleBoxes = () =>
    [...v.querySelectorAll('#rows tr')]
      .filter((tr) => !tr.hidden)
      .map((tr) => tr.querySelector('.sel'))
      .filter(Boolean)
  const updateSel = () => {
    $('selCount').textContent = selectedLeads.size ? `${selectedLeads.size} selected` : ''
    $('printBtn').disabled = selectedLeads.size === 0
    const boxes = visibleBoxes()
    $('selAll').checked = boxes.length > 0 && boxes.every((b) => b.checked)
  }

  v.querySelectorAll('#rows tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.sel')) return
      openLead(tr.dataset.id)
    })
  )
  v.querySelectorAll('.sel').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.checked ? selectedLeads.add(cb.dataset.id) : selectedLeads.delete(cb.dataset.id)
      updateSel()
    })
  )
  $('selAll').addEventListener('change', () => {
    const on = $('selAll').checked
    visibleBoxes().forEach((b) => {
      b.checked = on
      on ? selectedLeads.add(b.dataset.id) : selectedLeads.delete(b.dataset.id)
    })
    updateSel()
  })
  $('printBtn').addEventListener('click', () => {
    const recs = rows.filter((r) => selectedLeads.has(r.lead.id))
    if (recs.length) openVisitsDialog(recs)
  })
  $('csv').addEventListener('click', () => exportCsv(rows))
  applySearch()
  updateSel()
}

/* ---------- Visits PDF ---------- */
function openVisitsDialog(recs) {
  pushPanel(() => visitsPdfPanel(recs))
}
function visitsPdfPanel(recs) {
  const opt = (idv, label, def) =>
    `<label class="flex items-center gap-2.5 text-sm"><input type="checkbox" id="${idv}" class="h-4 w-4 accent-brand-600" ${
      def ? 'checked' : ''
    }/> ${label}</label>`
  setDrawerBody(`
    ${drawerHeader(
      '<h2 class="text-xl font-700">Visits PDF</h2>',
      `${recs.length} stop${recs.length === 1 ? '' : 's'} selected`
    )}
    <div class="flex-1 space-y-5 overflow-y-auto p-5">
      <div>
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Include on each stop</p>
        <div class="mt-3 space-y-2.5">
          ${opt('optAddress', 'Address', true)}
          ${opt('optPhones', 'Phone &amp; email', true)}
          ${opt('optNotes', 'Notes', true)}
          ${opt('optSpace', 'Blank write-space + checkboxes', true)}
        </div>
      </div>
      <div>
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Stops</p>
        <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
          ${recs.map((r) => `<li>${esc(leadTitle(r.lead, r.track))}</li>`).join('')}
        </ol>
      </div>
      <button id="genPdf" class="btn-primary w-full">Generate PDF</button>
    </div>`)
  $('genPdf').onclick = async () => {
    try {
      await withSaving(
        $('genPdf'),
        () =>
          generateVisitsPdf(recs, {
            address: $('optAddress').checked,
            phones: $('optPhones').checked,
            notes: $('optNotes').checked,
            space: $('optSpace').checked,
          }),
        'Done ✓'
      )
      toast('PDF generated')
      closeDrawer()
    } catch {
      /* withSaving handled */
    }
  }
}

async function generateVisitsPdf(recs, opts) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const M = 48
  const W = doc.internal.pageSize.getWidth()
  const Hp = doc.internal.pageSize.getHeight()
  let y = M
  const ensure = (need) => {
    if (y + need > Hp - M) {
      doc.addPage()
      y = M
    }
  }
  const wrap = (txt, size, maxW) => {
    doc.setFontSize(size)
    return doc.splitTextToSize(String(txt || ''), maxW)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('G&D Flooring — Visit Sheet', M, y)
  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(110)
  doc.text(
    `${new Date().toLocaleDateString([], { dateStyle: 'full' })}  ·  ${recs.length} stop${
      recs.length === 1 ? '' : 's'
    }`,
    M,
    y
  )
  doc.setTextColor(20)
  y += 16
  doc.setDrawColor(205)
  doc.line(M, y, W - M, y)
  y += 22

  const row = (label, val) => {
    if (!val) return
    const lines = wrap(val, 10, W - 2 * M - 64)
    ensure(lines.length * 13 + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(label, M, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(lines, M + 64, y)
    y += lines.length * 13 + 4
  }

  recs.forEach((r, i) => {
    const { lead, track } = r
    ensure(54)
    const headLines = wrap(`${i + 1}. ${leadTitle(lead, track)}`, 13, W - 2 * M - 80)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(headLines, M, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text((track?.status || 'New').toUpperCase(), W - M, y, { align: 'right' })
    doc.setTextColor(20)
    y += headLines.length * 16 + 6

    if (opts.address) {
      const ad = track?.address_id ? state.addrMap[track.address_id] : null
      row(
        'Address',
        ad
          ? [ad.label, ad.address, ad.notes && `(${ad.notes})`].filter(Boolean).join('  ·  ')
          : '—'
      )
    }
    if (opts.phones) {
      row('Phone', lead.phone || '—')
      row('Email', lead.email || '')
    }
    if (opts.notes) {
      const ns = (state.notesByLead[lead.id] || [])
        .slice()
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      if (ns.length) {
        ensure(16)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.text('Notes', M, y)
        y += 13
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        ns.slice(0, 6).forEach((n) => {
          const ls = wrap(
            `- ${new Date(n.timestamp).toLocaleDateString()}  ${n.text}`,
            10,
            W - 2 * M - 14
          )
          ensure(ls.length * 13 + 2)
          doc.text(ls, M + 14, y)
          y += ls.length * 13 + 2
        })
      } else row('Notes', '—')
    }
    if (opts.space) {
      ensure(78)
      doc.setDrawColor(225)
      for (let k = 0; k < 3; k++) {
        y += 20
        doc.line(M + 14, y, W - M, y)
      }
      y += 16
      doc.setDrawColor(90)
      doc.rect(M + 14, y - 9, 10, 10)
      doc.setFontSize(10)
      doc.text('Done', M + 30, y)
      doc.rect(M + 96, y - 9, 10, 10)
      doc.text('Follow-up', M + 112, y)
      y += 8
    }
    ensure(22)
    y += 8
    doc.setDrawColor(200)
    doc.line(M, y, W - M, y)
    y += 22
  })

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(`G&D Flooring · Visit Sheet · Page ${p} / ${pages}`, W / 2, Hp - 20, {
      align: 'center',
    })
  }
  doc.save(`gnd-visits-${new Date().toISOString().slice(0, 10)}.pdf`)
}

/* ---------- Calendar print ---------- */
function apptMeta(a) {
  const start = new Date(a.start)
  const dur =
    Number(a.duration_min) ||
    (a.end && !isNaN(new Date(a.end)) ? Math.max(15, Math.round((new Date(a.end) - start) / 60000)) : 60)
  const end = new Date(start.getTime() + dur * 60000)
  const rec = state.records.find((r) => r.lead.id === a.lead_id)
  const lead = rec?.lead
  const track = rec?.track
  const addr = track?.address_id ? state.addrMap[track.address_id] : null
  const notes = (state.notesByAppt[a.appt_id] || [])
    .slice()
    .sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))
  return {
    a,
    start,
    end,
    dur,
    rec,
    lead,
    track,
    addr,
    notes,
    title: rec ? leadTitle(lead, track) : a.notes || a.type,
  }
}
const apptsBetween = (from, to) =>
  state.schedule
    .map(apptMeta)
    .filter((m) => !isNaN(m.start) && m.start >= from && m.start < to)
    .sort((x, y) => x.start - y.start)

function openPrintDialog() {
  pushPanel(() => printPanel())
}
function printPanel() {
  const mode = calMode
  const opt = (id, label, def) =>
    `<label class="flex items-center gap-2.5 text-sm"><input type="checkbox" id="${id}" class="h-4 w-4 accent-brand-600" ${
      def ? 'checked' : ''
    }/> ${label}</label>`
  let periodText = ''
  let listHtml = ''
  if (mode === 'day') periodText = calCursor.toLocaleDateString([], { dateStyle: 'full' })
  else if (mode === 'week') {
    const ws = new Date(calCursor)
    ws.setDate(ws.getDate() - ws.getDay())
    const we = new Date(ws)
    we.setDate(ws.getDate() + 6)
    periodText = `Week of ${ws.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
  } else if (mode === 'month')
    periodText = calCursor.toLocaleString([], { month: 'long', year: 'numeric' })
  else {
    periodText = 'Selected appointments'
    const all = state.schedule
      .map(apptMeta)
      .filter((m) => !isNaN(m.start))
      .sort((x, y) => x.start - y.start)
    listHtml = `<div>
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Pick appointments</p>
        <button id="pkAll" type="button" class="text-xs font-600 text-brand-700">Select all</button>
      </div>
      <div class="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
        ${
          all
            .map(
              (m) =>
                `<label class="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-app"><input type="checkbox" class="pk h-4 w-4 accent-brand-600" data-appt="${m.a._row}"/> <span class="text-xs text-muted">${esc(m.start.toLocaleDateString([], { month: 'short', day: 'numeric' }))} ${esc(fmt12(`${m.start.getHours()}:${m.start.getMinutes()}`))}</span> ${esc(m.title)}</label>`
            )
            .join('') || '<p class="p-3 text-sm text-muted">No appointments.</p>'
        }
      </div>
    </div>`
  }
  const monthNote =
    mode === 'month'
      ? '<p class="rounded-lg bg-app p-3 text-xs text-muted">Month prints a one-page landscape grid (time + title per day). The detail toggles below apply to Day, Week and List, which are the on-the-road formats.</p>'
      : ''
  setDrawerBody(`${drawerHeader('<h2 class="text-xl font-700">Print schedule</h2>', `${TITLES.calendar} · ${esc(periodText)}`)}
    <div class="flex-1 space-y-5 overflow-y-auto p-5">
      <div class="rounded-lg border border-line p-3 text-sm">
        <span class="font-600">${esc(mode.charAt(0).toUpperCase() + mode.slice(1))}</span> — ${esc(periodText)}
      </div>
      ${monthNote}
      ${listHtml}
      <div>
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Include per appointment</p>
        <div class="mt-3 space-y-2.5">
          ${opt('pAddr', 'Address', true)}
          ${opt('pPhone', 'Phone &amp; email', true)}
          ${opt('pNotes', 'Latest notes', true)}
          ${opt('pGaps', 'Free-time between appointments', true)}
          ${opt('pSpace', 'Blank write-space + done box', true)}
          ${mode === 'week' ? opt('pSkip', 'Skip days with no appointments', true) : ''}
        </div>
      </div>
      <button id="genCal" class="btn-primary w-full">Generate PDF</button>
    </div>`)
  if (mode === 'list') {
    $('pkAll').addEventListener('click', () => {
      const boxes = [...$('drawerBody').querySelectorAll('.pk')]
      const allOn = boxes.every((b) => b.checked)
      boxes.forEach((b) => (b.checked = !allOn))
    })
  }
  $('genCal').onclick = async () => {
    const opts = {
      address: $('pAddr').checked,
      phone: $('pPhone').checked,
      notes: $('pNotes').checked,
      gaps: $('pGaps').checked,
      space: $('pSpace').checked,
      skipEmpty: $('pSkip') ? $('pSkip').checked : true,
    }
    let picked = []
    if (mode === 'list') {
      picked = [...$('drawerBody').querySelectorAll('.pk:checked')].map((b) => +b.dataset.appt)
      if (!picked.length) return toast('Select at least one appointment')
    }
    try {
      await withSaving($('genCal'), () => generateSchedulePdf(mode, opts, picked), 'Done ✓')
      toast('PDF generated')
      closeDrawer()
    } catch {
      /* handled */
    }
  }
}

async function generateSchedulePdf(mode, opts, picked) {
  const { jsPDF } = await import('jspdf')
  const landscape = mode === 'month'
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const Hp = doc.internal.pageSize.getHeight()
  const M = 44
  let y = M
  const t12 = (d) => fmt12(`${d.getHours()}:${d.getMinutes()}`)
  const wrap = (txt, size, w) => {
    doc.setFontSize(size)
    return doc.splitTextToSize(String(txt || ''), w)
  }
  const ensure = (need) => {
    if (y + need > Hp - M) {
      doc.addPage()
      y = M
    }
  }
  const pageTitle = (text, sub) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(text, M, y)
    y += 18
    if (sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(120)
      doc.text(sub, M, y)
      doc.setTextColor(20)
      y += 14
    }
    doc.setDrawColor(205)
    doc.line(M, y, W - M, y)
    y += 16
  }

  function renderDay(date, list) {
    pageTitle(date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      `${list.length} appointment${list.length === 1 ? '' : 's'}`)
    if (!list.length) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(11)
      doc.setTextColor(140)
      doc.text('No appointments scheduled.', M, y)
      doc.setTextColor(20)
      doc.setFont('helvetica', 'normal')
      y += 20
      return
    }
    list.forEach((m, i) => {
      ensure(64)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(`${t12(m.start)} – ${t12(m.end)}`, M, y)
      doc.setFontSize(12)
      const titleLines = wrap(`${m.title}  (${m.a.type})`, 12, W - 2 * M - 140)
      doc.text(titleLines, M + 140, y)
      y += Math.max(16, titleLines.length * 15)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      const line = (label, val) => {
        if (!val) return
        const ls = wrap(`${label}: ${val}`, 10, W - 2 * M - 140)
        ensure(ls.length * 13 + 2)
        doc.text(ls, M + 140, y)
        y += ls.length * 13 + 2
      }
      if (opts.address && m.addr)
        line('Address', [m.addr.label, m.addr.address, m.addr.notes && `(${m.addr.notes})`].filter(Boolean).join(' · '))
      if (opts.phone && m.lead) {
        line('Phone', m.lead.phone || '')
        line('Email', m.lead.email || '')
      }
      if (opts.notes && m.notes.length) {
        m.notes.slice(0, 3).forEach((n) => {
          const ls = wrap(`- ${new Date(n.timestamp).toLocaleDateString()}  ${n.text}`, 10, W - 2 * M - 152)
          ensure(ls.length * 13 + 2)
          doc.text(ls, M + 152, y)
          y += ls.length * 13 + 2
        })
      }
      if (opts.space) {
        ensure(58)
        doc.setDrawColor(225)
        for (let k = 0; k < 2; k++) {
          y += 18
          doc.line(M + 140, y, W - M, y)
        }
        y += 14
        doc.setDrawColor(90)
        doc.rect(M + 140, y - 9, 10, 10)
        doc.setFontSize(10)
        doc.text('Done', M + 156, y)
        y += 6
      }
      // free-time gap
      if (opts.gaps && i < list.length - 1) {
        const gapMin = Math.round((list[i + 1].start - m.end) / 60000)
        if (gapMin > 0) {
          const h = Math.floor(gapMin / 60)
          const mm = gapMin % 60
          ensure(20)
          y += 8
          doc.setDrawColor(220)
          doc.setLineDashPattern([2, 2], 0)
          doc.line(M, y, W - M, y)
          doc.setLineDashPattern([], 0)
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(9)
          doc.setTextColor(140)
          doc.text(`free ${h ? h + 'h ' : ''}${mm}m`, W / 2, y - 3, { align: 'center' })
          doc.setTextColor(20)
          doc.setFont('helvetica', 'normal')
          y += 12
        }
      } else {
        y += 6
      }
      ensure(10)
      doc.setDrawColor(210)
      doc.line(M, y, W - M, y)
      y += 14
    })
  }

  const startOfDay = (d) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }

  if (mode === 'day') {
    const from = startOfDay(calCursor)
    const to = new Date(from.getTime() + 864e5)
    renderDay(from, apptsBetween(from, to))
  } else if (mode === 'week') {
    const ws = startOfDay(calCursor)
    ws.setDate(ws.getDate() - ws.getDay())
    let first = true
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws)
      d.setDate(ws.getDate() + i)
      const list = apptsBetween(d, new Date(d.getTime() + 864e5))
      if (opts.skipEmpty && !list.length) continue
      if (!first) {
        doc.addPage()
        y = M
      }
      first = false
      renderDay(d, list)
    }
    if (first) {
      // nothing rendered
      pageTitle('Week', 'No appointments')
    }
  } else if (mode === 'list') {
    const picks = picked
      .map((row) => state.schedule.find((s) => s._row === row))
      .filter(Boolean)
      .map(apptMeta)
      .sort((x, y2) => x.start - y2.start)
    const byDay = {}
    picks.forEach((m) => ((byDay[startOfDay(m.start).getTime()] ||= []).push(m)))
    const keys = Object.keys(byDay)
      .map(Number)
      .sort((a, b) => a - b)
    keys.forEach((k, idx) => {
      if (idx) {
        ensure(120)
      }
      renderDay(new Date(k), byDay[k])
    })
  } else {
    // month — landscape grid
    const y0 = calCursor.getFullYear()
    const mo = calCursor.getMonth()
    pageTitle(calCursor.toLocaleString([], { month: 'long', year: 'numeric' }), '')
    const cols = 7
    const cellW = (W - 2 * M) / cols
    const startDow = new Date(y0, mo, 1).getDay()
    const days = new Date(y0, mo + 1, 0).getDate()
    const rows = Math.ceil((startDow + days) / 7)
    const gridTop = y
    const cellH = (Hp - M - gridTop) / rows
    const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    WD.forEach((d, i) => doc.text(d, M + i * cellW + 4, gridTop - 4))
    doc.setFont('helvetica', 'normal')
    let cell = 0
    for (let i = 0; i < startDow; i++, cell++) {
      // empty leading cells
      const cx = M + (cell % 7) * cellW
      const cy = gridTop + Math.floor(cell / 7) * cellH
      doc.setDrawColor(225)
      doc.rect(cx, cy, cellW, cellH)
    }
    for (let d = 1; d <= days; d++, cell++) {
      const cx = M + (cell % 7) * cellW
      const cy = gridTop + Math.floor(cell / 7) * cellH
      doc.setDrawColor(210)
      doc.rect(cx, cy, cellW, cellH)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(String(d), cx + 4, cy + 12)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      const day = new Date(y0, mo, d)
      const list = apptsBetween(day, new Date(day.getTime() + 864e5))
      let ly = cy + 24
      list.slice(0, 5).forEach((m) => {
        if (ly > cy + cellH - 6) return
        const txt = doc.splitTextToSize(`${t12(m.start)} ${m.title}`, cellW - 8)[0]
        doc.text(txt, cx + 4, ly)
        ly += 10
      })
      if (list.length > 5) doc.text(`+${list.length - 5} more`, cx + 4, Math.min(ly, cy + cellH - 4))
    }
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(`G&D Flooring · Schedule · ${p}/${pages}`, W / 2, Hp - 18, { align: 'center' })
  }
  doc.save(`gnd-schedule-${mode}-${new Date().toISOString().slice(0, 10)}.pdf`)
}

/* ---------- Lead panel ---------- */
function openLead(id) {
  pushPanel(() => leadPanel(id))
}
function leadPanel(id) {
  const rec = state.records.find((r) => r.lead.id === id)
  if (!rec) return popPanel()
  const { lead, track } = rec
  const title = leadTitle(lead, track)
  const hist = state.activity
    .filter((a) => a.id === id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  const appts = state.schedule
    .filter((a) => a.lead_id === id)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
  const pool = tagPool()
  const notes = (state.notesByLead[id] || [])
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  const linked = track?.address_id ? state.addrMap[track.address_id] : null
  const addrDisplay = (a) => `${a.label ? a.label + ' — ' : ''}${a.address}`

  setDrawerBody(`
    ${drawerHeader(
      `<div class="flex items-center gap-2">${badge(track?.status || 'New')}</div>
       <h2 class="mt-2 truncate text-xl font-700">${esc(title)}</h2>`,
      `${esc(lead.name || '')} · ${fmtDT(lead.submittedAt || lead.timestamp)}`
    )}
    <div class="flex-1 space-y-6 overflow-y-auto p-5">
      <section class="grid grid-cols-2 gap-3 text-sm">
        ${field('Email', `<a class="text-brand-700 hover:underline" href="mailto:${esc(lead.email)}">${esc(lead.email || '—')}</a>`)}
        ${field('Phone', `<a class="text-brand-700 hover:underline" href="tel:${esc(lead.phone)}">${esc(lead.phone || '—')}</a>`)}
        ${field('Source', esc(lead.source || '—'))}
        ${field('Service', esc(lead.service || '—'))}
      </section>
      <section>
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Message</p>
        <p class="mt-1.5 whitespace-pre-wrap rounded-xl bg-app p-3 text-sm">${esc(lead.message || '—')}</p>
      </section>

      <section class="rounded-xl border border-line p-4">
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Details</p>
        <div class="mt-3 space-y-3">
          <label class="block text-sm font-600">Title
            <input id="dwTitle" class="field mt-1" value="${esc(track?.title || '')}" placeholder="${esc(title)}"/>
          </label>
          <label class="block text-sm font-600">Status
            <select id="dwStatus" class="field mt-1">
              ${PIPELINE.map((s) => `<option ${(track?.status || 'New') === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
          </label>
          <div class="block text-sm font-600">Tags
            ${tagEditorHtml('dwTags', track?.tags || '')}
          </div>
          <button id="dwSave" class="btn-primary w-full">Save changes</button>
        </div>
      </section>

      <section class="rounded-xl border border-line p-4">
        <div class="flex items-center justify-between">
          <p class="text-xs font-700 uppercase tracking-wider text-muted">Address</p>
          ${linked ? '<button id="dwUnlink" class="text-xs font-600 text-rose-600">unlink</button>' : ''}
        </div>
        ${
          linked
            ? `<div class="mt-2 rounded-lg bg-app p-3 text-sm">
                 <p class="font-600">${esc(linked.label || 'Address')}</p>
                 <p>${esc(linked.address || '')}</p>
                 ${linked.notes ? `<p class="mt-0.5 text-xs text-muted">${esc(linked.notes)}</p>` : ''}
               </div>`
            : '<p class="mt-2 text-sm text-muted">No address linked.</p>'
        }
        <div class="mt-3 space-y-2">
          <div class="flex gap-2">
            <input id="dwAddrSearch" class="field" list="addrOpts" placeholder="Search existing addresses…"/>
            <datalist id="addrOpts">${state.addresses
              .map((a) => `<option value="${esc(addrDisplay(a))}">`)
              .join('')}</datalist>
            <button id="dwAddrLink" class="btn-ghost shrink-0">Link</button>
          </div>
          <button id="dwAddrNewToggle" class="text-xs font-600 text-brand-700">+ New address</button>
          <div id="dwAddrNew" hidden class="space-y-2 rounded-lg border border-line p-3">
            <input id="naLabel" class="field" placeholder="Label (e.g. Job site)"/>
            <input id="naAddr" class="field" placeholder="Address — street, city, ZIP"/>
            <input id="naNotes" class="field" placeholder="Notes (gate code, parking…)"/>
            <button id="naSave" class="btn-primary w-full">Save &amp; link</button>
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-line p-4">
        <div class="flex items-center justify-between">
          <p class="text-xs font-700 uppercase tracking-wider text-muted">Appointments</p>
          <button id="dwAddAppt" class="text-xs font-600 text-brand-700">+ Add</button>
        </div>
        <ul class="mt-2 space-y-1.5 text-sm">
          ${
            appts
              .map(
                (a) =>
                  `<li data-appt="${a._row}" class="flex cursor-pointer items-center justify-between rounded-lg bg-app px-3 py-2 hover:bg-brand-50"><span>${esc(
                    a.type
                  )} · ${fmtDT(a.start)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted"><path d="M9 18l6-6-6-6"/></svg></li>`
              )
              .join('') || '<li class="text-sm text-muted">None scheduled</li>'
          }
        </ul>
      </section>

      <section class="rounded-xl border border-line p-4">
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Notes</p>
        <div class="mt-3 flex gap-2">
          <textarea id="dwNote" rows="2" class="field" placeholder="Add a note…"></textarea>
          <button id="dwNoteAdd" class="btn-primary shrink-0 self-start">Add</button>
        </div>
        <ul class="mt-3 space-y-2">
          ${
            notes
              .map(
                (n) => `<li data-note="${n._row}" class="cursor-pointer rounded-lg bg-app p-3 text-sm hover:bg-brand-50">
              <p class="whitespace-pre-wrap">${esc(n.text)}</p>
              <p class="mt-1 text-[11px] text-muted">${fmtDT(n.timestamp)} · ${esc(n.author)}</p>
              ${n.tags ? `<div class="mt-1 flex flex-wrap gap-1">${tagPills(n.tags)}</div>` : ''}
            </li>`
              )
              .join('') || '<li class="text-sm text-muted">No notes yet</li>'
          }
        </ul>
      </section>

      <details class="rounded-xl border border-line p-4">
        <summary class="cursor-pointer select-none text-xs font-700 uppercase tracking-wider text-muted">History (${hist.length})</summary>
        <ol class="mt-3 space-y-3 border-l-2 border-line pl-4">
          ${
            hist
              .map(
                (h) => `<li class="relative">
            <span class="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-400 ring-2 ring-surface"></span>
            <p class="text-sm font-600">${esc(h.action)}</p>
            ${
              h.old_value || h.new_value
                ? `<p class="text-xs text-muted">${esc(h.old_value || '∅')} → <span class="text-ink-700">${esc(
                    h.new_value || '∅'
                  )}</span></p>`
                : ''
            }
            <p class="text-[11px] text-muted">${fmtDT(h.timestamp)} · ${esc(h.actor)}</p>
          </li>`
              )
              .join('') || '<li class="text-sm text-muted">No history yet</li>'
          }
        </ol>
      </details>
    </div>`)

  wireTagEditor('dwTags')
  $('dwSave').addEventListener('click', async () => {
    try {
      await withSaving($('dwSave'), async () => {
        await saveTracking(
          id,
          { status: $('dwStatus').value, tags: $('dwTags').value.trim(), title: $('dwTitle').value.trim() },
          getEmail(),
          track
        )
        await reload(false)
      })
      refreshDrawer()
    } catch {
      /* withSaving toasted + restored */
    }
  })

  const relinkAddress = async (addressId, btn) => {
    try {
      await withSaving(btn, async () => {
        await saveTracking(id, { address_id: addressId }, getEmail(), track)
        await reload(false)
      })
      toast(addressId ? 'Address linked' : 'Address unlinked')
      refreshDrawer()
    } catch {
      /* handled */
    }
  }
  const addrByDisplay = {}
  state.addresses.forEach(
    (a) => (addrByDisplay[`${a.label ? a.label + ' — ' : ''}${a.address}`] = a.address_id)
  )
  $('dwAddrLink').addEventListener('click', () => {
    const aid = addrByDisplay[$('dwAddrSearch').value.trim()]
    if (!aid) return toast('Pick an address from the list')
    relinkAddress(aid, $('dwAddrLink'))
  })
  if ($('dwUnlink')) $('dwUnlink').addEventListener('click', () => relinkAddress('', $('dwUnlink')))
  $('dwAddrNewToggle').addEventListener('click', () => {
    const el = $('dwAddrNew')
    el.hidden = !el.hidden
  })
  $('naSave').addEventListener('click', async () => {
    const label = $('naLabel').value.trim()
    const address = $('naAddr').value.trim()
    if (!label && !address) return toast('Enter an address')
    try {
      await withSaving($('naSave'), async () => {
        const aid = await addAddress({ label, address, notes: $('naNotes').value.trim() }, getEmail())
        await saveTracking(id, { address_id: aid }, getEmail(), track)
        await reload(false)
      })
      toast('Address linked')
      refreshDrawer()
    } catch {
      /* handled */
    }
  })
  $('dwNoteAdd').addEventListener('click', async () => {
    const text = $('dwNote').value.trim()
    if (!text) return
    try {
      await withSaving($('dwNoteAdd'), async () => {
        await addNote(id, text, getEmail())
        await reload(false)
      })
      refreshDrawer()
    } catch {
      /* handled */
    }
  })
  $('dwAddAppt').addEventListener('click', () => openNewAppt({ leadId: id }))
  $('drawerBody')
    .querySelectorAll('[data-appt]')
    .forEach((el) => el.addEventListener('click', () => openVisit(+el.dataset.appt)))
  $('drawerBody')
    .querySelectorAll('[data-note]')
    .forEach((el) => el.addEventListener('click', () => openEditNote(+el.dataset.note)))
}

/* ---------- Visit panel (view / edit) ---------- */
let visitEditing = false
function openVisit(apptRow) {
  visitEditing = false
  pushPanel(() => visitPanel(apptRow))
}
function visitPanel(apptRow) {
  const a = state.schedule.find((x) => x._row === apptRow)
  if (!a) return popPanel()
  const rec = state.records.find((r) => r.lead.id === a.lead_id)
  const lt = rec ? leadTitle(rec.lead, rec.track) : a.lead_id ? '(unknown lead)' : '(no lead)'
  const start = new Date(a.start)
  const dur =
    Number(a.duration_min) ||
    (a.end && !isNaN(new Date(a.end)) ? Math.max(15, Math.round((new Date(a.end) - start) / 60000)) : 60)
  const vnotes = (state.notesByAppt[a.appt_id] || [])
    .slice()
    .sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))
  const head = drawerHeader(
    `<span class="text-xs font-700 uppercase tracking-wider text-muted">Visit</span>
     <h2 class="mt-1 truncate text-xl font-700">${esc(a.type)}</h2>`,
    esc(start.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }))
  )

  if (visitEditing) {
    const dVal = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
    const tVal = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    const leadOpt = (r) => [leadTitle(r.lead, r.track), r.lead.name, r.lead.email].filter(Boolean).join(' · ')
    const optMap = {}
    state.records.forEach((r) => (optMap[leadOpt(r)] = r.lead.id))
    setDrawerBody(`${head}
      <div class="flex-1 space-y-4 overflow-y-auto p-5">
        <label class="block text-sm font-600">Lead
          <input id="vLead" class="field mt-1" list="vLeadPool" value="${rec ? esc(leadOpt(rec)) : ''}" placeholder="search title, name or email"/>
          <datalist id="vLeadPool">${state.records.map((r) => `<option value="${esc(leadOpt(r))}">`).join('')}</datalist>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <div class="block text-sm font-600">Date<input id="vDate" type="date" class="field mt-1" value="${dVal}"/></div>
          <div class="block text-sm font-600">Start${timeFieldHtml('vTime', tVal)}</div>
          <div class="block text-sm font-600">Duration${durationFieldHtml('vDur', dur)}</div>
          <div class="block text-sm font-600">Type<select id="vType" class="field mt-1">${APPT_TYPES.map((t) => `<option ${a.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        </div>
        <div class="flex gap-2">
          <button id="vSave" class="btn-primary flex-1">Save changes</button>
          <button id="vCancel" class="btn-ghost">Cancel</button>
        </div>
      </div>`)
    wireTime('vTime')
    wireDuration('vDur')
    $('vCancel').addEventListener('click', () => {
      visitEditing = false
      refreshDrawer()
    })
    $('vSave').addEventListener('click', async () => {
      const lid = optMap[$('vLead').value.trim()] || (rec ? rec.lead.id : '')
      const startIso = new Date(`${$('vDate').value}T${$('vTime').value || '09:00'}`).toISOString()
      try {
        await withSaving($('vSave'), async () => {
          await updateAppointment(
            a._row,
            { lead_id: lid, type: $('vType').value, start: startIso, duration_min: Number($('vDur').value) || 60 },
            getEmail(),
            a
          )
          await reload(false)
        })
        visitEditing = false
        refreshDrawer()
      } catch {
        /* handled */
      }
    })
    return
  }

  setDrawerBody(`${head}
    <div class="flex-1 space-y-5 overflow-y-auto p-5">
      <button id="vLeadOpen" class="flex w-full items-center justify-between rounded-xl border border-line p-3 text-left hover:bg-app ${rec ? '' : 'pointer-events-none opacity-60'}">
        <div><p class="text-xs font-700 uppercase tracking-wide text-muted">Lead</p><p class="mt-0.5 font-600">${esc(lt)}</p></div>
        ${rec ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted"><path d="M9 18l6-6-6-6"/></svg>' : ''}
      </button>
      <div class="grid grid-cols-2 gap-3 text-sm">
        ${field('Date', esc(start.toLocaleDateString([], { dateStyle: 'medium' })))}
        ${field('Start', esc(start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })))}
        ${field('Duration', `${dur} min`)}
        ${field('Type', esc(a.type))}
      </div>
      <section class="rounded-xl border border-line p-4">
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Visit notes</p>
        <div class="mt-3 flex gap-2">
          <textarea id="vNote" rows="2" class="field" placeholder="Add a visit note…"></textarea>
          <button id="vNoteAdd" class="btn-primary shrink-0 self-start">Add</button>
        </div>
        <ul class="mt-3 space-y-2">
          ${
            vnotes
              .map(
                (n) => `<li data-note="${n._row}" class="cursor-pointer rounded-lg bg-app p-3 text-sm hover:bg-brand-50">
              <p class="whitespace-pre-wrap">${esc(n.text)}</p>
              <p class="mt-1 text-[11px] text-muted">${fmtDT(n.timestamp)} · ${esc(n.author)}</p>
            </li>`
              )
              .join('') || '<li class="text-sm text-muted">No visit notes</li>'
          }
        </ul>
      </section>
      <div class="flex gap-2">
        <button id="vEdit" class="btn-primary flex-1">Edit</button>
        <button id="vDelete" class="btn-danger">Delete</button>
      </div>
    </div>`)
  if (rec) $('vLeadOpen').addEventListener('click', () => openLead(a.lead_id))
  $('vEdit').addEventListener('click', () => {
    visitEditing = true
    refreshDrawer()
  })
  $('vDelete').addEventListener('click', async () => {
    if (!confirm('Delete this appointment?')) return
    try {
      await withSaving(
        $('vDelete'),
        async () => {
          await deleteAppointment(a._row, a.lead_id, getEmail(), a.type)
          await reload(false)
        },
        'Deleted'
      )
      popPanel()
    } catch {
      /* handled */
    }
  })
  $('vNoteAdd').addEventListener('click', async () => {
    const text = $('vNote').value.trim()
    if (!text) return
    try {
      await withSaving($('vNoteAdd'), async () => {
        await addNote(a.lead_id, text, getEmail(), { appt_id: a.appt_id, tags: 'visit' })
        await reload(false)
      })
      refreshDrawer()
    } catch {
      /* handled */
    }
  })
  $('drawerBody')
    .querySelectorAll('[data-note]')
    .forEach((el) => el.addEventListener('click', () => openEditNote(+el.dataset.note)))
}

/* ---------- New appointment panel ---------- */
function openNewAppt(opts = {}) {
  pushPanel(() => newApptPanel(opts))
}
function newApptPanel({ date, leadId } = {}) {
  const base = date ? new Date(date) : new Date()
  const dVal = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
  const presetRec = leadId ? state.records.find((r) => r.lead.id === leadId) : null
  const leadOpt = (r) => [leadTitle(r.lead, r.track), r.lead.name, r.lead.email].filter(Boolean).join(' · ')
  const optMap = {}
  state.records.forEach((r) => (optMap[leadOpt(r)] = r.lead.id))
  setDrawerBody(`${drawerHeader('<h2 class="text-xl font-700">New appointment</h2>', '')}
    <div class="flex-1 space-y-4 overflow-y-auto p-5">
      <label class="block text-sm font-600">Lead
        <input id="vLead" class="field mt-1" list="vLeadPool" value="${presetRec ? esc(leadOpt(presetRec)) : ''}" placeholder="search title, name or email"/>
        <datalist id="vLeadPool">${state.records.map((r) => `<option value="${esc(leadOpt(r))}">`).join('')}</datalist>
      </label>
      <div class="grid grid-cols-2 gap-3">
        <div class="block text-sm font-600">Date<input id="vDate" type="date" class="field mt-1" value="${dVal}"/></div>
        <div class="block text-sm font-600">Start${timeFieldHtml('vTime', '09:00')}</div>
        <div class="block text-sm font-600">Duration${durationFieldHtml('vDur', 60)}</div>
        <div class="block text-sm font-600">Type<select id="vType" class="field mt-1">${APPT_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <button id="vCreate" class="btn-primary w-full">Create appointment</button>
    </div>`)
  wireTime('vTime')
  wireDuration('vDur')
  $('vCreate').addEventListener('click', async () => {
    const lid = optMap[$('vLead').value.trim()] || (presetRec ? presetRec.lead.id : '')
    const startIso = new Date(`${$('vDate').value}T${$('vTime').value || '09:00'}`).toISOString()
    try {
      let newId
      await withSaving(
        $('vCreate'),
        async () => {
          newId = await addAppointment(
            { lead_id: lid, type: $('vType').value, start: startIso, duration_min: Number($('vDur').value) || 60 },
            getEmail()
          )
          await reload(false)
        },
        'Created ✓'
      )
      const created = state.schedule.find((s) => s.appt_id === newId)
      drawerStack.pop()
      if (created) openVisit(created._row)
      else renderDrawer()
    } catch {
      /* handled */
    }
  })
}

/* ---------- Edit-note panel ---------- */
function openEditNote(noteRow) {
  pushPanel(() => editNotePanel(noteRow))
}
function editNotePanel(noteRow) {
  const n = state.notes.find((x) => x._row === noteRow)
  if (!n) return popPanel()
  const rec = state.records.find((r) => r.lead.id === n.lead_id)
  const lt = rec ? leadTitle(rec.lead, rec.track) : n.lead_id || '(no lead)'
  const allTags = [
    ...new Set(
      state.notes.flatMap((x) =>
        String(x.tags || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    ),
  ]
  setDrawerBody(`${drawerHeader('<h2 class="text-xl font-700">Edit note</h2>', esc(lt))}
    <div class="flex-1 space-y-4 overflow-y-auto p-5">
      <button id="enLead" class="flex w-full items-center justify-between rounded-xl border border-line p-3 text-left hover:bg-app ${rec ? '' : 'pointer-events-none opacity-60'}">
        <div><p class="text-xs font-700 uppercase tracking-wide text-muted">Lead</p><p class="mt-0.5 font-600">${esc(lt)}</p></div>
        ${rec ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted"><path d="M9 18l6-6-6-6"/></svg>' : ''}
      </button>
      <label class="block text-sm font-600">Note
        <textarea id="enText" rows="6" class="field mt-1">${esc(n.text)}</textarea>
      </label>
      <div class="block text-sm font-600">Tags
        ${tagEditorHtml('enTags', n.tags || '')}
      </div>
      <p class="text-[11px] text-muted">${fmtDT(n.timestamp)} · ${esc(n.author)}${n.appt_id ? ' · visit note' : ''}</p>
      <div class="flex gap-2">
        <button id="enSave" class="btn-primary flex-1">Save</button>
        <button id="enDelete" class="btn-danger">Delete</button>
      </div>
    </div>`)
  wireTagEditor('enTags')
  if (rec) $('enLead').addEventListener('click', () => openLead(n.lead_id))
  $('enSave').addEventListener('click', async () => {
    try {
      await withSaving($('enSave'), async () => {
        await updateNote(n._row, { text: $('enText').value.trim(), tags: $('enTags').value.trim() }, getEmail(), n)
        await reload(false)
      })
      refreshDrawer()
    } catch {
      /* handled */
    }
  })
  $('enDelete').addEventListener('click', async () => {
    if (!confirm('Delete this note?')) return
    try {
      await withSaving(
        $('enDelete'),
        async () => {
          await deleteNote(n._row, n.lead_id, getEmail())
          await reload(false)
        },
        'Deleted'
      )
      popPanel()
    } catch {
      /* handled */
    }
  })
}
const field = (label, val) =>
  `<div><p class="text-xs font-700 uppercase tracking-wide text-muted">${label}</p><p class="mt-0.5">${val}</p></div>`

function exportCsv(rows) {
  const head = ['received', 'name', 'email', 'phone', 'service', 'message', 'status', 'tags', 'notes']
  const c = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const lines = [head.join(',')]
  rows.forEach(({ lead, track }) =>
    lines.push(
      [
        lead.submittedAt || lead.timestamp,
        lead.name,
        lead.email,
        lead.phone,
        lead.service,
        lead.message,
        track?.status || '',
        track?.tags || '',
        track?.notes || '',
      ]
        .map(c)
        .join(',')
    )
  )
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  a.download = `gnd-leads-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

/* ---------- Calendar (Day / Week / Month / List) ---------- */
function calendar(v) {
  const today = new Date()
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const events = [
    ...state.schedule
      .map((a) => ({ when: new Date(a.start), kind: 'appt', a }))
      .filter((x) => !isNaN(x.when)),
    ...state.tasks
      .filter((t) => t.due_date)
      .map((t) => ({ when: new Date(t.due_date), kind: 'task', t }))
      .filter((x) => !isNaN(x.when)),
  ]
  const itemsOn = (d) =>
    events.filter((x) => sameDay(x.when, d)).sort((a, b) => a.when - b.when)
  const tnow = (d) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  const chip = (x, withTime) =>
    x.kind === 'task'
      ? `<div class="truncate rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800" title="${esc(
          x.t.title
        )}">📋 ${esc(x.t.title)}</div>`
      : `<div class="truncate rounded bg-brand-100 px-1.5 py-0.5 text-[11px] text-brand-800 cursor-pointer" data-appt="${
          x.a._row
        }" title="${esc(x.a.type)} ${esc(leadName(x.a.lead_id) || x.a.notes || '')}">${
          withTime ? esc(tnow(x.when)) + ' ' : ''
        }${esc(x.a.type)} ${esc(leadName(x.a.lead_id) || '')}</div>`

  const eventRow = (x, showDate) => {
    const meta = `${showDate ? esc(x.when.toLocaleDateString([], { month: 'short', day: 'numeric' })) + ' · ' : ''}${esc(tnow(x.when))}`
    if (x.kind === 'task')
      return `<div class="flex items-center gap-3 px-4 py-3">
        <span class="badge bg-amber-100 text-amber-800">Task</span>
        <span class="text-sm">${esc(x.t.title)}</span>
        <span class="ml-auto text-xs text-muted">${meta}</span></div>`
    return `<div class="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-app" data-appt="${x.a._row}">
      <span class="badge bg-brand-100 text-brand-800">${esc(x.a.type)}</span>
      <span class="text-sm">${esc(leadName(x.a.lead_id) || x.a.notes || '—')}</span>
      <span class="ml-auto text-xs text-muted">${meta}</span></div>`
  }

  let title = ''
  let body = ''

  if (calMode === 'month') {
    const y = calCursor.getFullYear()
    const m = calCursor.getMonth()
    const startDow = new Date(y, m, 1).getDay()
    const days = new Date(y, m + 1, 0).getDate()
    title = calCursor.toLocaleString([], { month: 'long', year: 'numeric' })
    let cells = ''
    for (let i = 0; i < startDow; i++) cells += '<div></div>'
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m, d)
      const its = itemsOn(dt)
      const isToday = sameDay(dt, today)
      cells += `<div data-date="${dt.getTime()}" class="min-h-28 cursor-pointer rounded-xl border bg-surface p-2 transition hover:border-brand-400 ${
        isToday ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'
      }">
        <span class="text-xs font-700 ${isToday ? 'text-brand-700' : 'text-muted'}">${d}</span>
        <div class="mt-1 space-y-1">${its.slice(0, 4).map((x) => chip(x, false)).join('')}</div>
        ${its.length > 4 ? `<p class="mt-1 text-[11px] text-muted">+${its.length - 4} more</p>` : ''}
      </div>`
    }
    body = `<div class="grid grid-cols-7 gap-1.5 text-center text-xs font-700 text-muted">
        ${WD.map((d) => `<div>${d}</div>`).join('')}
      </div>
      <div class="mt-1.5 grid grid-cols-7 gap-1.5">${cells}</div>`
  } else if (calMode === 'week') {
    const ws = new Date(calCursor)
    ws.setDate(ws.getDate() - ws.getDay())
    ws.setHours(0, 0, 0, 0)
    const wdays = [...Array(7)].map((_, i) => {
      const d = new Date(ws)
      d.setDate(ws.getDate() + i)
      return d
    })
    title = `${wdays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${wdays[6].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
    body = `<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-7">${wdays
      .map((d) => {
        const its = itemsOn(d)
        const isToday = sameDay(d, today)
        return `<div data-date="${d.getTime()}" class="min-h-48 cursor-pointer rounded-xl border bg-surface p-2 ${
          isToday ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'
        }">
          <p class="text-xs font-700 ${isToday ? 'text-brand-700' : 'text-muted'}">${d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</p>
          <div class="mt-1.5 space-y-1">${its.map((x) => chip(x, true)).join('') || '<p class="text-[11px] text-muted">—</p>'}</div>
        </div>`
      })
      .join('')}</div>`
  } else if (calMode === 'day') {
    title = calCursor.toLocaleDateString([], { dateStyle: 'full' })
    const dt = new Date(
      calCursor.getFullYear(),
      calCursor.getMonth(),
      calCursor.getDate()
    )
    const its = itemsOn(calCursor)
    body = `<div data-date="${dt.getTime()}" class="card cursor-pointer divide-y divide-line">
      ${its.map((x) => eventRow(x, false)).join('') || '<p class="p-10 text-center text-sm text-muted">No appointments. Click to add one.</p>'}
    </div>`
  } else {
    title = 'Agenda'
    const sorted = [...events].sort((a, b) => a.when - b.when)
    const groups = []
    let cur = null
    for (const x of sorted) {
      const key = x.when.toDateString()
      if (!cur || cur.key !== key) {
        cur = {
          key,
          label:
            (sameDay(x.when, today) ? 'Today · ' : '') +
            x.when.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
          items: [],
        }
        groups.push(cur)
      }
      cur.items.push(x)
    }
    body = groups.length
      ? groups
          .map(
            (g) => `<div class="mb-5">
        <p class="mb-2 text-xs font-700 uppercase tracking-wider text-muted">${esc(g.label)}</p>
        <div class="card divide-y divide-line">${g.items.map((x) => eventRow(x, false)).join('')}</div>
      </div>`
          )
          .join('')
      : '<div class="card p-10 text-center text-muted">Nothing scheduled</div>'
  }

  const seg = (mode, label) =>
    `<button data-mode="${mode}" class="px-3 py-1.5 text-sm font-600 ${
      calMode === mode ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-app'
    }">${label}</button>`

  v.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="inline-flex divide-x divide-line overflow-hidden rounded-lg border border-line bg-surface">
        ${seg('day', 'Day')}${seg('week', 'Week')}${seg('month', 'Month')}${seg('list', 'List')}
      </div>
      ${
        calMode !== 'list'
          ? `<button id="pm" class="btn-ghost !px-2.5">‹</button>
             <button id="tm" class="btn-ghost">Today</button>
             <button id="nm" class="btn-ghost !px-2.5">›</button>`
          : ''
      }
      <h2 class="text-lg font-700">${esc(title)}</h2>
      <div class="ml-auto flex gap-2">
        <button id="printCal" class="btn-ghost">Print</button>
        <button id="addAppt" class="btn-primary">+ Appointment</button>
      </div>
    </div>
    ${body}`

  v.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      calMode = b.dataset.mode
      calendar(v)
    })
  )
  if (calMode !== 'list') {
    const shift = (dir) => {
      const d = new Date(calCursor)
      if (calMode === 'month') d.setMonth(d.getMonth() + dir)
      else if (calMode === 'week') d.setDate(d.getDate() + 7 * dir)
      else d.setDate(d.getDate() + dir)
      calCursor = d
      calendar(v)
    }
    $('pm').onclick = () => shift(-1)
    $('nm').onclick = () => shift(1)
    $('tm').onclick = () => {
      calCursor = new Date()
      calendar(v)
    }
  }
  $('addAppt').onclick = () =>
    openNewAppt({ date: calMode === 'day' ? new Date(calCursor) : new Date() })
  $('printCal').onclick = () => openPrintDialog()
  v.querySelectorAll('[data-date]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-appt]')) return
      openNewAppt({ date: new Date(+el.dataset.date) })
    })
  )
  v.querySelectorAll('[data-appt]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      openVisit(+el.dataset.appt)
    })
  )
}

/* ---------- To-Do ---------- */
function todo(v) {
  const openTasks = state.tasks.filter((t) => String(t.done).toUpperCase() !== 'TRUE')
  v.innerHTML = `
    <div class="grid gap-4 lg:grid-cols-2">
      <section class="card p-6">
        <h2 class="text-lg font-700">Needs action <span class="text-sm font-400 text-muted">(${items.length})</span></h2>
        <ul class="mt-4 space-y-2">
          ${
            items
              .map(
                (it) => `<li class="flex items-center gap-3 rounded-xl border border-line p-3 sla-${it.severity}">
            <span class="h-2 w-2 shrink-0 rounded-full ${sevColor[it.severity]}"></span>
            <div class="min-w-0 flex-1 ${it.leadId ? 'cursor-pointer' : ''}" ${
                  it.leadId ? `data-lead="${esc(it.leadId)}"` : ''
                }>
              <p class="text-sm font-600">${esc(it.title)}</p>
              <p class="truncate text-xs text-muted">${esc(it.detail)}</p>
            </div>
            <select data-snooze="${esc(it.key)}" data-l="${esc(it.leadId || '')}" class="field !w-auto !py-1 text-xs">
              <option value="">snooze…</option><option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option>
            </select>
          </li>`
              )
              .join('') ||
            '<li class="rounded-xl bg-app p-6 text-center text-sm text-muted">All clear 🎉</li>'
          }
        </ul>
      </section>
      <section class="card p-6">
        <h2 class="text-lg font-700">Manual tasks <span class="text-sm font-400 text-muted">(${openTasks.length})</span></h2>
        <div class="mt-4 flex gap-2">
          <input id="tTitle" placeholder="New task…" class="field flex-1"/>
          <input id="tDue" type="date" class="field !w-auto"/>
          <button id="tAdd" class="btn-primary">Add</button>
        </div>
        <ul class="mt-4 space-y-2">
          ${
            openTasks
              .map(
                (t) => `<li class="flex items-center gap-3 rounded-xl border border-line p-3">
            <input type="checkbox" data-done="${t._row}" data-l="${esc(t.lead_id || '')}" class="h-4 w-4 accent-brand-600"/>
            <div class="flex-1"><p class="text-sm font-600">${esc(t.title)}</p>${
                  t.due_date ? `<p class="text-xs text-muted">due ${fmtD(t.due_date)}</p>` : ''
                }</div>
          </li>`
              )
              .join('') || '<li class="rounded-xl bg-app p-6 text-center text-sm text-muted">No open tasks</li>'
          }
        </ul>
      </section>
    </div>`
  v.querySelectorAll('[data-lead]').forEach((d) =>
    d.addEventListener('click', () => openLead(d.dataset.lead))
  )
  v.querySelectorAll('[data-snooze]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      const days = +sel.value
      if (!days) return
      try {
        await addSnooze(
          sel.dataset.snooze,
          sel.dataset.l,
          new Date(Date.now() + days * 864e5).toISOString(),
          getEmail()
        )
        toast(`Snoozed ${days}d`)
        await reload(false)
      } catch (e) {
        toast('Failed: ' + e.message)
      }
    })
  )
  $('tAdd').onclick = async () => {
    const title = $('tTitle').value.trim()
    if (!title) return
    try {
      await addTask({ title, due_date: $('tDue').value }, getEmail())
      toast('Task added')
      await reload(false)
    } catch (e) {
      toast('Failed: ' + e.message)
    }
  }
  v.querySelectorAll('[data-done]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      try {
        await setTaskDone(+cb.dataset.done, cb.checked, getEmail(), cb.dataset.l)
        toast('Updated')
        await reload(false)
      } catch (e) {
        toast('Failed: ' + e.message)
      }
    })
  )
}

/* ---------- Notes page ---------- */
function notesView(v) {
  const rows = [...state.notes].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  )
  const allTags = [
    ...new Set(
      state.notes.flatMap((n) =>
        String(n.tags || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    ),
  ].sort()
  const leadLabel = (lid) => {
    const r = state.records.find((x) => x.lead.id === lid)
    return r ? leadTitle(r.lead, r.track) : lid || '(no lead)'
  }
  v.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <span class="text-sm text-muted">${rows.length} note${rows.length === 1 ? '' : 's'}</span>
      <input id="nQ" placeholder="Search by lead…" class="field !w-64" />
      <select id="nTag" class="field !w-auto">
        <option value="">All tags</option>
        ${allTags.map((t) => `<option>${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div class="card divide-y divide-line">
      <div id="nRows">
        ${
          rows
            .map((n) => {
              const ll = leadLabel(n.lead_id)
              const s = `${ll} ${n.text} ${n.tags}`.toLowerCase()
              return `<button data-note="${n._row}" data-s="${esc(s)}" data-tags="${esc(n.tags || '')}" class="flex w-full items-start gap-3 p-4 text-left hover:bg-app">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-600">${esc(ll)}</p>
                <p class="mt-0.5 line-clamp-2 text-sm text-ink-700">${esc(n.text)}</p>
                <p class="mt-1 text-[11px] text-muted">${fmtDT(n.timestamp)} · ${esc(n.author)}${n.appt_id ? ' · visit' : ''}</p>
                ${n.tags ? `<div class="mt-1 flex flex-wrap gap-1">${tagPills(n.tags)}</div>` : ''}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mt-1 shrink-0 text-muted"><path d="M9 18l6-6-6-6"/></svg>
            </button>`
            })
            .join('') ||
          '<p class="p-10 text-center text-sm text-muted">No notes yet</p>'
        }
      </div>
    </div>`
  const apply = () => {
    const term = $('nQ').value.toLowerCase()
    const tag = $('nTag').value
    for (const b of $('nRows').children) {
      if (!b.dataset) continue
      const okText = !term || (b.dataset.s || '').includes(term)
      const okTag =
        !tag ||
        String(b.dataset.tags || '')
          .split(',')
          .map((s) => s.trim())
          .includes(tag)
      b.hidden = !(okText && okTag)
    }
  }
  $('nQ').addEventListener('input', apply)
  $('nTag').addEventListener('change', apply)
  $('nRows')
    .querySelectorAll('[data-note]')
    .forEach((b) => b.addEventListener('click', () => openEditNote(+b.dataset.note)))
}

/* ---------- Settings page (tag colours) ---------- */
function settingsView(v) {
  const tags = allKnownTags()
  const suggestion = (i) => TAG_PALETTE[i % TAG_PALETTE.length]
  v.innerHTML = `
    <div class="mx-auto max-w-2xl space-y-6">
      <section class="card p-6">
        <h2 class="text-lg font-700">Tags &amp; colours</h2>
        <p class="mt-1 text-sm text-muted">Pick a colour for each tag. Tags appear as coloured pills across leads, notes and the board.</p>
        <div class="mt-5 space-y-2" id="tagList">
          ${
            tags
              .map((t, i) => {
                const c = tagColor(t) || suggestion(i)
                const has = !!tagColor(t)
                return `<div class="flex items-center gap-3 rounded-lg border border-line p-2.5" data-row="${esc(t)}">
                  <span class="inline-block rounded-full px-2.5 py-1 text-xs font-600" ${pillStyle(tagColor(t))}>${esc(t)}</span>
                  <span class="flex-1"></span>
                  ${has ? '' : '<span class="text-[11px] text-muted">no colour</span>'}
                  <input type="color" data-color="${esc(t)}" value="${c}" class="h-8 w-10 cursor-pointer rounded border border-line bg-surface p-0.5"/>
                  <button data-del="${esc(t)}" class="btn-danger !px-2 text-xs">Delete</button>
                </div>`
              })
              .join('') || '<p class="text-sm text-muted">No tags yet. Add one below.</p>'
          }
        </div>
      </section>
      <section class="card p-6">
        <h2 class="text-lg font-700">Add a tag</h2>
        <div class="mt-4 flex flex-wrap items-end gap-3">
          <label class="text-sm font-600">Name<input id="ntName" class="field mt-1 !w-56" placeholder="e.g. priority"/></label>
          <label class="text-sm font-600">Colour<input id="ntColor" type="color" value="${TAG_PALETTE[0]}" class="mt-1 block h-10 w-14 cursor-pointer rounded border border-line bg-surface p-0.5"/></label>
          <button id="ntAdd" class="btn-primary">Add tag</button>
        </div>
      </section>
    </div>`

  v.querySelectorAll('[data-color]').forEach((inp) =>
    inp.addEventListener('change', async () => {
      const t = inp.dataset.color
      state.tagColors[t.trim().toLowerCase()] = inp.value
      try {
        await upsertTag(t, inp.value)
        toast('Colour saved')
        settingsView(v)
      } catch (e) {
        toast('Failed: ' + e.message)
      }
    })
  )
  v.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = b.dataset.del
      if (!confirm(`Delete the colour for "${t}"? (the tag stays on leads/notes)`)) return
      try {
        await withSaving(b, async () => {
          await deleteTag(t)
          await reload(false)
        }, 'Deleted')
        render()
      } catch {
        /* handled */
      }
    })
  )
  $('ntAdd').addEventListener('click', async () => {
    const name = $('ntName').value.trim()
    if (!name) return toast('Enter a tag name')
    try {
      await withSaving($('ntAdd'), async () => {
        await upsertTag(name, $('ntColor').value)
        await reload(false)
      })
      render()
    } catch {
      /* handled */
    }
  })
}

start()
