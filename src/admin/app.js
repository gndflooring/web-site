import './admin.css'
import { CLIENT_ID, SPREADSHEET_ID, PIPELINE, APPT_TYPES } from './config.js'
import { signIn, signOut, resume, getEmail } from './auth.js'
import {
  ensureTabs,
  loadAll,
  saveTracking,
  addAppointment,
  deleteAppointment,
  addTask,
  setTaskDone,
  addSnooze,
} from './sheets.js'
import { computeNeedsAction, severityByLead } from './heuristics.js'

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
const TITLES = { dashboard: 'Dashboard', board: 'Pipeline Board', leads: 'Leads', calendar: 'Calendar', todo: 'To-Do' }

let state = null
let items = []
let view = 'dashboard'
let calCursor = new Date()
let wired = false
const collapsedCols = new Set()
const savingLeads = new Set()

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
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer())
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

/* ---------- Drawer ---------- */
function openDrawer(html) {
  $('drawerBody').innerHTML = html
  $('drawer').classList.add('open')
  $('drawerBackdrop').classList.add('open')
}
function closeDrawer() {
  $('drawer').classList.remove('open')
  $('drawerBackdrop').classList.remove('open')
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
    ${r.track?.tags ? `<p class="mt-1.5 truncate text-[11px] text-brand-700">${esc(r.track.tags)}</p>` : ''}
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
  v.innerHTML = `
    <div class="mb-4 flex items-center gap-3">
      <span class="text-sm text-muted">${rows.length} lead${rows.length === 1 ? '' : 's'}</span>
      <button id="csv" class="btn-ghost ml-auto">Export CSV</button>
    </div>
    <div class="card overflow-hidden">
      <div class="max-h-[calc(100vh-220px)] overflow-auto">
        <table class="tbl">
          <thead><tr>
            <th>Received</th><th>Name</th><th>Service</th><th>Status</th><th>Tags</th><th>Updated</th><th></th>
          </tr></thead>
          <tbody id="rows">
            ${
              rows
                .map(({ lead, track }) => {
                  const s = [lead.name, lead.email, lead.phone, lead.service, lead.message, track?.tags]
                    .join(' ')
                    .toLowerCase()
                  return `<tr data-id="${esc(lead.id)}" data-s="${esc(s)}">
                  <td class="whitespace-nowrap text-xs text-muted">${fmtDT(lead.submittedAt || lead.timestamp)}</td>
                  <td class="font-700">${esc(lead.name || '—')}</td>
                  <td>${esc(lead.service || '—')}</td>
                  <td>${badge(track?.status || 'New')}</td>
                  <td class="max-w-[180px] truncate text-xs text-brand-700">${esc(track?.tags || '')}</td>
                  <td class="whitespace-nowrap text-xs text-muted">${track?.updated_at ? fmtDT(track.updated_at) : '—'}</td>
                  <td class="text-muted"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></td>
                </tr>`
                })
                .join('') ||
              '<tr><td colspan="7" class="p-10 text-center text-muted">No leads yet</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`
  v.querySelectorAll('#rows tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => openLead(tr.dataset.id))
  )
  $('csv').addEventListener('click', () => exportCsv(rows))
  applySearch()
}

/* ---------- Lead detail + history drawer ---------- */
function openLead(id) {
  const rec = state.records.find((r) => r.lead.id === id)
  if (!rec) return
  const { lead, track } = rec
  const hist = state.activity
    .filter((a) => a.id === id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  const appts = state.schedule
    .filter((a) => a.lead_id === id)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
  const pool = tagPool()

  openDrawer(`
    <header class="flex items-start gap-3 border-b border-line p-5">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">${badge(track?.status || 'New')}</div>
        <h2 class="mt-2 truncate text-xl font-700">${esc(lead.name || 'Lead')}</h2>
        <p class="text-sm text-muted">${esc(lead.service || '')} · ${fmtDT(lead.submittedAt || lead.timestamp)}</p>
      </div>
      <button id="dwClose" class="btn-ghost !px-2" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>
    <div class="flex-1 space-y-6 overflow-y-auto p-5">
      <section class="grid grid-cols-2 gap-3 text-sm">
        ${field('Email', `<a class="text-brand-700 hover:underline" href="mailto:${esc(lead.email)}">${esc(lead.email || '—')}</a>`)}
        ${field('Phone', `<a class="text-brand-700 hover:underline" href="tel:${esc(lead.phone)}">${esc(lead.phone || '—')}</a>`)}
        ${field('Source', esc(lead.source || '—'))}
        ${field('Lead ID', `<span class="font-mono text-xs">${esc(lead.id)}</span>`)}
      </section>
      <section>
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Message</p>
        <p class="mt-1.5 whitespace-pre-wrap rounded-xl bg-app p-3 text-sm">${esc(lead.message || '—')}</p>
      </section>

      <section class="rounded-xl border border-line p-4">
        <p class="text-xs font-700 uppercase tracking-wider text-muted">Update</p>
        <div class="mt-3 space-y-3">
          <label class="block text-sm font-600">Status
            <select id="dwStatus" class="field mt-1">
              ${PIPELINE.map((s) => `<option ${(track?.status || 'New') === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
          </label>
          <label class="block text-sm font-600">Tags
            <input id="dwTags" class="field mt-1" list="tagPool" value="${esc(track?.tags || '')}" placeholder="kitchen, urgent"/>
            <datalist id="tagPool">${pool.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
          </label>
          <label class="block text-sm font-600">Notes
            <textarea id="dwNotes" rows="3" class="field mt-1" placeholder="Internal notes…">${esc(track?.notes || '')}</textarea>
          </label>
          <button id="dwSave" class="btn-primary w-full">Save changes</button>
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between">
          <p class="text-xs font-700 uppercase tracking-wider text-muted">Appointments</p>
          <button id="dwAddAppt" class="text-xs font-600 text-brand-700">+ Add</button>
        </div>
        <ul class="mt-2 space-y-1.5 text-sm">
          ${
            appts
              .map(
                (a) =>
                  `<li class="flex items-center justify-between rounded-lg bg-app px-3 py-2"><span>${esc(
                    a.type
                  )} · ${fmtDT(a.start)}</span><button data-del-appt="${a._row}" data-label="${esc(
                    a.type
                  )}" class="text-xs text-rose-600">remove</button></li>`
              )
              .join('') || '<li class="text-sm text-muted">None scheduled</li>'
          }
        </ul>
      </section>

      <section>
        <p class="text-xs font-700 uppercase tracking-wider text-muted">History</p>
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
      </section>
    </div>`)

  $('dwClose').addEventListener('click', closeDrawer)
  $('dwSave').addEventListener('click', async () => {
    const btn = $('dwSave')
    btn.disabled = true
    try {
      await saveTracking(
        id,
        {
          status: $('dwStatus').value,
          tags: $('dwTags').value.trim(),
          notes: $('dwNotes').value.trim(),
        },
        getEmail(),
        track
      )
      toast('Saved')
      await reload(false)
      openLead(id)
    } catch (e) {
      toast('Save failed: ' + e.message)
      btn.disabled = false
    }
  })
  $('dwAddAppt').addEventListener('click', () => openApptForm(new Date(), id))
  $('drawerBody')
    .querySelectorAll('[data-del-appt]')
    .forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await deleteAppointment(+b.dataset.delAppt, id, getEmail(), b.dataset.label)
          toast('Removed')
          await reload(false)
          openLead(id)
        } catch (e) {
          toast('Failed: ' + e.message)
        }
      })
    )
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

/* ---------- Calendar ---------- */
function calendar(v) {
  const y = calCursor.getFullYear()
  const m = calCursor.getMonth()
  const startDow = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const byDay = {}
  state.schedule.forEach((a) => {
    const d = new Date(a.start)
    if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m)
      (byDay[d.getDate()] ||= []).push(a)
  })
  state.tasks.forEach((t) => {
    if (!t.due_date) return
    const d = new Date(t.due_date)
    if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m)
      (byDay[d.getDate()] ||= []).push({ _task: true, ...t })
  })
  const todayKey = new Date().toDateString()
  let cells = ''
  for (let i = 0; i < startDow; i++) cells += '<div></div>'
  for (let d = 1; d <= days; d++) {
    const isToday = new Date(y, m, d).toDateString() === todayKey
    cells += `<button class="min-h-28 rounded-xl border bg-surface p-2 text-left transition hover:border-brand-400 ${
      isToday ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line'
    }" data-day="${d}">
      <span class="text-xs font-700 ${isToday ? 'text-brand-700' : 'text-muted'}">${d}</span>
      ${(byDay[d] || [])
        .slice(0, 4)
        .map((x) =>
          x._task
            ? `<div class="mt-1 truncate rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">📋 ${esc(x.title)}</div>`
            : `<div class="mt-1 truncate rounded bg-brand-100 px-1.5 py-0.5 text-[11px] text-brand-800">${esc(
                x.type
              )} ${esc(leadName(x.lead_id) || '')}</div>`
        )
        .join('')}
    </button>`
  }
  v.innerHTML = `
    <div class="mb-4 flex items-center gap-2">
      <button id="pm" class="btn-ghost !px-2.5">‹</button>
      <h2 class="min-w-44 text-center text-lg font-700">${esc(
        calCursor.toLocaleString([], { month: 'long', year: 'numeric' })
      )}</h2>
      <button id="nm" class="btn-ghost !px-2.5">›</button>
      <button id="tm" class="btn-ghost">Today</button>
      <button id="addAppt" class="btn-primary ml-auto">+ Appointment</button>
    </div>
    <div class="grid grid-cols-7 gap-1.5 text-center text-xs font-700 text-muted">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div>${d}</div>`).join('')}
    </div>
    <div class="mt-1.5 grid grid-cols-7 gap-1.5">${cells}</div>`
  $('pm').onclick = () => {
    calCursor = new Date(y, m - 1, 1)
    render()
  }
  $('nm').onclick = () => {
    calCursor = new Date(y, m + 1, 1)
    render()
  }
  $('tm').onclick = () => {
    calCursor = new Date()
    render()
  }
  $('addAppt').onclick = () => openApptForm(new Date())
  v.querySelectorAll('[data-day]').forEach((b) =>
    b.addEventListener('click', () => openApptForm(new Date(y, m, +b.dataset.day)))
  )
}

function openApptForm(date, presetLead) {
  const dayAppts = state.schedule
    .filter((a) => {
      const d = new Date(a.start)
      return !isNaN(d) && d.toDateString() === date.toDateString()
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start))
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  const preset = presetLead ? state.records.find((r) => r.lead.id === presetLead) : null
  openDrawer(`
    <header class="flex items-start justify-between border-b border-line p-5">
      <div>
        <h2 class="text-xl font-700">Appointments</h2>
        <p class="text-sm text-muted">${date.toLocaleDateString([], { dateStyle: 'full' })}</p>
      </div>
      <button id="dwClose" class="btn-ghost !px-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </header>
    <div class="flex-1 space-y-5 overflow-y-auto p-5">
      <ul class="space-y-1.5 text-sm">
        ${
          dayAppts
            .map(
              (a) =>
                `<li class="flex items-center justify-between rounded-lg bg-app px-3 py-2"><span>${esc(
                  a.type
                )} · ${fmtDT(a.start)} · ${esc(leadName(a.lead_id) || a.notes || '')}</span><button data-del="${
                  a._row
                }" data-lead="${esc(a.lead_id)}" data-label="${esc(a.type)}" class="text-xs text-rose-600">remove</button></li>`
            )
            .join('') || '<li class="text-muted">No appointments this day.</li>'
        }
      </ul>
      <div class="rounded-xl border border-line p-4">
        <p class="text-xs font-700 uppercase tracking-wider text-muted">New appointment</p>
        <div class="mt-3 grid gap-3">
          <label class="text-sm font-600">Type<select id="aType" class="field mt-1">${APPT_TYPES.map(
            (t) => `<option>${esc(t)}</option>`
          ).join('')}</select></label>
          <label class="text-sm font-600">Start<input id="aStart" type="datetime-local" value="${iso}" class="field mt-1"/></label>
          <label class="text-sm font-600">Lead${
            preset
              ? ` <span class="font-400 text-muted">— ${esc(preset.lead.name)}</span>`
              : ''
          }<input id="aLead" list="leadPool" class="field mt-1" placeholder="search name / email" value="${
            preset ? esc(preset.lead.name + ' — ' + preset.lead.email) : ''
          }"/>
            <datalist id="leadPool">${state.records
              .map((r) => `<option value="${esc(r.lead.name)} — ${esc(r.lead.email)}">`)
              .join('')}</datalist></label>
          <label class="text-sm font-600">Notes<input id="aNotes" class="field mt-1"/></label>
          <button id="aSave" class="btn-primary">Save appointment</button>
        </div>
      </div>
    </div>`)
  $('dwClose').addEventListener('click', closeDrawer)
  $('drawerBody')
    .querySelectorAll('[data-del]')
    .forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await deleteAppointment(+b.dataset.del, b.dataset.lead, getEmail(), b.dataset.label)
          toast('Removed')
          await reload(false)
          openApptForm(date, presetLead)
        } catch (e) {
          toast('Failed: ' + e.message)
        }
      })
    )
  $('aSave').onclick = async () => {
    const match = state.records.find(
      (r) => `${r.lead.name} — ${r.lead.email}` === $('aLead').value
    )
    try {
      await addAppointment(
        {
          lead_id: match?.lead.id || (preset ? preset.lead.id : ''),
          type: $('aType').value,
          start: new Date($('aStart').value).toISOString(),
          notes: $('aNotes').value.trim(),
        },
        getEmail()
      )
      toast('Appointment saved')
      await reload(false)
      openApptForm(date, presetLead)
    } catch (e) {
      toast('Failed: ' + e.message)
    }
  }
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

start()
