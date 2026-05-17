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
const statusCls = (s) => 'st-' + String(s || 'New').replace(/\s+/g, '')
const fmtDateTime = (v) => {
  const d = new Date(v)
  return isNaN(d) ? esc(v) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
const fmtDate = (v) => {
  const d = new Date(v)
  return isNaN(d) ? esc(v) : d.toLocaleDateString([], { dateStyle: 'medium' })
}

let state = null
let items = []
let view = 'dashboard'
let calCursor = new Date()

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.style.opacity = '1'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => (t.style.opacity = '0'), 2600)
}

/* ---------------- Auth bootstrap ---------------- */
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
    const email = await resume()
    if (email) return enterApp()
  } catch {
    /* fall through to sign-in */
  }
}

$('signInBtn').addEventListener('click', async () => {
  $('signinMsg').textContent = ''
  $('signInBtn').disabled = true
  try {
    await signIn()
    await enterApp()
  } catch (e) {
    $('signinMsg').textContent =
      e.code === 'UNAUTHORIZED' ? e.message : `Sign-in failed: ${e.message}`
  } finally {
    $('signInBtn').disabled = false
  }
})

$('signOutBtn').addEventListener('click', () => {
  signOut()
  location.reload()
})

$('refreshBtn').addEventListener('click', () => reload(true))

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]')
  if (!b) return
  view = b.dataset.view
  render()
})

async function enterApp() {
  $('signin').hidden = true
  $('app').hidden = false
  const em = getEmail()
  $('userEmail').textContent = em || ''
  $('userEmail').classList.remove('hidden')
  await reload(false)
}

async function reload(notify) {
  $('view').innerHTML = '<p class="p-10 text-center text-muted">Loading…</p>'
  try {
    await ensureTabs()
    state = await loadAll()
    items = computeNeedsAction(state)
    render()
    if (notify) toast('Refreshed')
  } catch (e) {
    $('view').innerHTML =
      `<div class="card mx-auto max-w-xl p-8 text-center"><p class="font-600 text-rose-600">Could not load data</p><p class="mt-2 text-sm text-muted">${esc(
        e.message
      )}</p><p class="mt-4 text-xs text-muted">Check that the spreadsheet is shared with your account and the Sheets API is enabled.</p></div>`
  }
}

/* ---------------- View router ---------------- */
function render() {
  for (const b of $('tabs').children) {
    b.className =
      'rounded-lg px-3 py-1.5 ' +
      (b.dataset.view === view ? 'bg-brand-600 text-white' : 'hover:bg-white')
  }
  if (!state) return
  const v = $('view')
  if (view === 'dashboard') renderDashboard(v)
  else if (view === 'board') renderBoard(v)
  else if (view === 'leads') renderLeads(v)
  else if (view === 'calendar') renderCalendar(v)
  else if (view === 'todo') renderTodo(v)
}

const sevDot = {
  urgent: '<span class="inline-block h-2 w-2 rounded-full bg-rose-500"></span>',
  due: '<span class="inline-block h-2 w-2 rounded-full bg-amber-500"></span>',
  normal: '<span class="inline-block h-2 w-2 rounded-full bg-slate-300"></span>',
}

/* ---------------- Dashboard ---------------- */
function renderDashboard(v) {
  const now = Date.now()
  const soon = state.schedule
    .map((a) => ({ a, t: new Date(a.start).getTime() }))
    .filter((x) => !isNaN(x.t) && x.t < now + 7 * 864e5)
    .sort((x, y) => x.t - y.t)
  const openTasks = state.tasks.filter((t) => String(t.done).toUpperCase() !== 'TRUE')

  v.innerHTML = `
    <div class="grid gap-6 lg:grid-cols-3">
      <section class="card p-6 lg:col-span-2">
        <h2 class="text-lg font-600">Needs action <span class="text-sm font-400 text-muted">(${items.length})</span></h2>
        <ul class="mt-4 space-y-2">
          ${
            items.slice(0, 12).map((it) => `
            <li class="flex items-start gap-3 rounded-lg border border-ink/5 bg-cream/40 p-3 sla-${it.severity}">
              ${sevDot[it.severity]}
              <div class="min-w-0">
                <p class="text-sm font-600">${esc(it.title)}</p>
                <p class="truncate text-xs text-muted">${esc(it.detail)}</p>
              </div>
            </li>`).join('') || '<li class="text-sm text-muted">All clear 🎉</li>'
          }
        </ul>
        ${items.length > 12 ? `<button class="mt-4 text-sm font-600 text-brand-700" data-goto="todo">View all in To-Do →</button>` : ''}
      </section>
      <div class="space-y-6">
        <section class="card p-6">
          <h2 class="text-lg font-600">Next 7 days</h2>
          <ul class="mt-3 space-y-2 text-sm">
            ${
              soon.slice(0, 8).map((x) => `
              <li class="flex justify-between gap-3">
                <span class="truncate">${esc(x.a.type)} — ${esc(leadName(x.a.lead_id) || x.a.notes || '')}</span>
                <span class="shrink-0 text-muted">${fmtDateTime(x.a.start)}</span>
              </li>`).join('') || '<li class="text-muted">Nothing scheduled</li>'
            }
          </ul>
          <button class="mt-3 text-sm font-600 text-brand-700" data-goto="calendar">Open calendar →</button>
        </section>
        <section class="card p-6">
          <h2 class="text-lg font-600">Open tasks <span class="text-sm font-400 text-muted">(${openTasks.length})</span></h2>
          <button class="mt-3 text-sm font-600 text-brand-700" data-goto="todo">Go to To-Do →</button>
        </section>
      </div>
    </div>`
  v.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.goto
      render()
    })
  )
}

const leadName = (id) => {
  const r = state.records.find((x) => x.lead.id === id)
  return r ? r.lead.name : ''
}

/* ---------------- Board (Kanban) ---------------- */
function renderBoard(v) {
  const sev = severityByLead(items)
  const byStatus = {}
  PIPELINE.forEach((s) => (byStatus[s] = []))
  for (const rec of state.records) {
    const st = rec.track?.status && PIPELINE.includes(rec.track.status) ? rec.track.status : 'New'
    byStatus[st].push(rec)
  }
  v.innerHTML = `
    <p class="mb-4 text-sm text-muted">Drag a card to change its status.</p>
    <div class="flex gap-4 overflow-x-auto pb-4">
      ${PIPELINE.map(
        (s) => `
        <div class="kanban-col" data-col="${esc(s)}">
          <div class="mb-2 flex items-center justify-between px-1">
            <span class="text-sm font-700">${esc(s)}</span>
            <span class="rounded-full bg-ink/5 px-2 text-xs">${byStatus[s].length}</span>
          </div>
          <div class="col-drop space-y-2 rounded-xl bg-ink/[0.03] p-2" data-col="${esc(s)}" style="min-height:120px">
            ${byStatus[s]
              .map(
                (r) => `
              <div class="card cursor-grab p-3 sla-${sev[r.lead.id] || 'normal'}" draggable="true" data-id="${esc(
                  r.lead.id
                )}">
                <p class="text-sm font-600">${esc(r.lead.name || 'Lead')}</p>
                <p class="truncate text-xs text-muted">${esc(r.lead.service || '')}</p>
                <p class="mt-1 truncate text-xs text-muted">${esc(r.lead.email || '')}</p>
                ${
                  r.track?.tags
                    ? `<p class="mt-1 text-[11px] text-brand-700">${esc(r.track.tags)}</p>`
                    : ''
                }
              </div>`
              )
              .join('')}
          </div>
        </div>`
      ).join('')}
    </div>`

  let dragId = null
  v.querySelectorAll('[draggable=true]').forEach((c) => {
    c.addEventListener('dragstart', () => (dragId = c.dataset.id))
  })
  v.querySelectorAll('.col-drop').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault()
      col.classList.add('drag-over')
    })
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'))
    col.addEventListener('drop', async () => {
      col.classList.remove('drag-over')
      const id = dragId
      const newStatus = col.dataset.col
      const rec = state.records.find((r) => r.lead.id === id)
      if (!rec || (rec.track?.status || 'New') === newStatus) return
      try {
        await saveTracking(id, { status: newStatus }, getEmail(), rec.track)
        toast(`Moved to ${newStatus}`)
        await reload(false)
      } catch (e) {
        toast('Save failed: ' + e.message)
      }
    })
  })
}

/* ---------------- Leads table ---------------- */
function allTags() {
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

function renderLeads(v) {
  const tags = allTags()
  const rows = [...state.records].sort(
    (a, b) => new Date(b.lead.submittedAt || b.lead.timestamp) - new Date(a.lead.submittedAt || a.lead.timestamp)
  )
  v.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <input id="q" placeholder="Search name, email, message…" class="w-72 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm" />
      <span class="text-sm text-muted">${rows.length} leads</span>
      <button id="csv" class="btn-ghost ml-auto">Export CSV</button>
    </div>
    <datalist id="tagOpts">${tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[1000px] text-sm">
        <thead class="bg-ink/[0.03] text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th class="p-3">Received</th><th class="p-3">Name</th><th class="p-3">Contact</th>
            <th class="p-3">Service</th><th class="p-3">Message</th><th class="p-3">Status</th>
            <th class="p-3">Tags</th><th class="p-3">Notes</th><th class="p-3"></th>
          </tr>
        </thead>
        <tbody id="rows">
          ${rows.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`

  const q = $('q')
  q.addEventListener('input', () => {
    const term = q.value.toLowerCase()
    for (const tr of $('rows').children) {
      tr.hidden = term && !tr.dataset.search.includes(term)
    }
  })
  $('csv').addEventListener('click', () => exportCsv(rows))
  $('rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-save]')
    if (!btn) return
    const id = btn.dataset.save
    const tr = btn.closest('tr')
    const rec = state.records.find((r) => r.lead.id === id)
    btn.disabled = true
    try {
      await saveTracking(
        id,
        {
          status: tr.querySelector('[data-f=status]').value,
          tags: tr.querySelector('[data-f=tags]').value.trim(),
          notes: tr.querySelector('[data-f=notes]').value.trim(),
        },
        getEmail(),
        rec.track
      )
      toast('Saved')
      await reload(false)
    } catch (err) {
      toast('Save failed: ' + err.message)
      btn.disabled = false
    }
  })
}

function rowHtml({ lead, track }) {
  const search = [lead.name, lead.email, lead.phone, lead.service, lead.message]
    .join(' ')
    .toLowerCase()
  return `<tr class="border-t border-ink/5 align-top" data-search="${esc(search)}">
    <td class="p-3 whitespace-nowrap text-xs text-muted">${fmtDateTime(lead.submittedAt || lead.timestamp)}</td>
    <td class="p-3 font-600">${esc(lead.name)}</td>
    <td class="p-3 text-xs"><div>${esc(lead.email)}</div><div class="text-muted">${esc(lead.phone)}</div></td>
    <td class="p-3">${esc(lead.service)}</td>
    <td class="p-3 max-w-xs"><div class="line-clamp-3 text-xs">${esc(lead.message)}</div></td>
    <td class="p-3">
      <select data-f="status" class="rounded-md border border-ink/15 px-2 py-1 text-xs">
        ${PIPELINE.map(
          (s) => `<option ${(track?.status || 'New') === s ? 'selected' : ''}>${esc(s)}</option>`
        ).join('')}
      </select>
    </td>
    <td class="p-3"><input data-f="tags" list="tagOpts" value="${esc(track?.tags || '')}" class="w-36 rounded-md border border-ink/15 px-2 py-1 text-xs" placeholder="tag, tag"/></td>
    <td class="p-3"><input data-f="notes" value="${esc(track?.notes || '')}" class="w-48 rounded-md border border-ink/15 px-2 py-1 text-xs" placeholder="notes"/></td>
    <td class="p-3"><button data-save="${esc(lead.id)}" class="btn-primary !px-3 !py-1 text-xs">Save</button></td>
  </tr>`
}

function exportCsv(rows) {
  const head = ['received', 'name', 'email', 'phone', 'service', 'message', 'status', 'tags', 'notes']
  const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const lines = [head.join(',')]
  for (const { lead, track } of rows) {
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
        .map(cell)
        .join(',')
    )
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `gnd-leads-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

/* ---------------- Calendar ---------------- */
function renderCalendar(v) {
  const y = calCursor.getFullYear()
  const m = calCursor.getMonth()
  const first = new Date(y, m, 1)
  const startDow = first.getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const byDay = {}
  for (const a of state.schedule) {
    const d = new Date(a.start)
    if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m) {
      ;(byDay[d.getDate()] ||= []).push(a)
    }
  }
  for (const t of state.tasks) {
    if (!t.due_date) continue
    const d = new Date(t.due_date)
    if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m) {
      ;(byDay[d.getDate()] ||= []).push({ _task: true, ...t })
    }
  }
  const monthName = calCursor.toLocaleString([], { month: 'long', year: 'numeric' })
  let cells = ''
  for (let i = 0; i < startDow; i++) cells += '<div></div>'
  const todayKey = new Date().toDateString()
  for (let d = 1; d <= days; d++) {
    const isToday = new Date(y, m, d).toDateString() === todayKey
    cells += `<button class="min-h-24 rounded-lg border border-ink/10 bg-white p-1.5 text-left hover:border-brand-400 ${
      isToday ? 'ring-2 ring-brand-400' : ''
    }" data-day="${d}">
      <div class="text-xs font-600 ${isToday ? 'text-brand-700' : 'text-muted'}">${d}</div>
      ${(byDay[d] || [])
        .map((x) =>
          x._task
            ? `<div class="mt-1 truncate rounded bg-amber-100 px-1 text-[11px] text-amber-800">📋 ${esc(x.title)}</div>`
            : `<div class="mt-1 truncate rounded bg-brand-100 px-1 text-[11px] text-brand-800">${esc(x.type)} ${esc(
                leadName(x.lead_id) || ''
              )}</div>`
        )
        .join('')}
    </button>`
  }
  v.innerHTML = `
    <div class="mb-4 flex items-center gap-3">
      <button id="pm" class="btn-ghost">‹</button>
      <h2 class="text-lg font-600">${esc(monthName)}</h2>
      <button id="nm" class="btn-ghost">›</button>
      <button id="tm" class="btn-ghost ml-2">Today</button>
      <button id="addAppt" class="btn-primary ml-auto">+ Appointment</button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs font-600 text-muted">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div>${d}</div>`).join('')}
    </div>
    <div class="mt-1 grid grid-cols-7 gap-1">${cells}</div>
    <div id="apptPanel" class="mt-5"></div>`

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
  $('addAppt').onclick = () => openApptForm(new Date(y, m, new Date().getDate()))
  v.querySelectorAll('[data-day]').forEach((b) =>
    b.addEventListener('click', () => openApptForm(new Date(y, m, +b.dataset.day)))
  )
}

function openApptForm(date) {
  const p = $('apptPanel')
  const dayAppts = state.schedule.filter((a) => {
    const d = new Date(a.start)
    return !isNaN(d) && d.toDateString() === date.toDateString()
  })
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
  p.innerHTML = `
    <div class="card p-5">
      <h3 class="font-600">${date.toLocaleDateString([], { dateStyle: 'full' })}</h3>
      <div class="mt-3 space-y-1 text-sm">
        ${
          dayAppts
            .map(
              (a) => `<div class="flex items-center justify-between rounded bg-cream/60 px-3 py-2">
            <span>${esc(a.type)} · ${fmtDateTime(a.start)} · ${esc(leadName(a.lead_id) || a.notes || '')}</span>
            <button data-del="${a._row}" data-lead="${esc(a.lead_id)}" data-label="${esc(a.type)}" class="text-xs text-rose-600">remove</button>
          </div>`
            )
            .join('') || '<p class="text-muted">No appointments.</p>'
        }
      </div>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label class="text-sm">Type
          <select id="aType" class="mt-1 w-full rounded-md border border-ink/15 px-2 py-1.5">${APPT_TYPES.map(
            (t) => `<option>${esc(t)}</option>`
          ).join('')}</select>
        </label>
        <label class="text-sm">Start
          <input id="aStart" type="datetime-local" value="${iso}" class="mt-1 w-full rounded-md border border-ink/15 px-2 py-1.5"/>
        </label>
        <label class="text-sm">Lead (optional)
          <input id="aLead" list="leadOpts" placeholder="search name/email" class="mt-1 w-full rounded-md border border-ink/15 px-2 py-1.5"/>
          <datalist id="leadOpts">${state.records
            .map((r) => `<option value="${esc(r.lead.name)} — ${esc(r.lead.email)}" data-id="${esc(r.lead.id)}">`)
            .join('')}</datalist>
        </label>
        <label class="text-sm">Notes
          <input id="aNotes" class="mt-1 w-full rounded-md border border-ink/15 px-2 py-1.5"/>
        </label>
      </div>
      <button id="aSave" class="btn-primary mt-4">Save appointment</button>
    </div>`
  p.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await deleteAppointment(+b.dataset.del, b.dataset.lead, getEmail(), b.dataset.label)
        toast('Removed')
        await reload(false)
        openApptForm(date)
      } catch (e) {
        toast('Failed: ' + e.message)
      }
    })
  )
  $('aSave').onclick = async () => {
    const label = $('aLead').value
    const match = state.records.find(
      (r) => `${r.lead.name} — ${r.lead.email}` === label
    )
    try {
      await addAppointment(
        {
          lead_id: match?.lead.id || '',
          type: $('aType').value,
          start: new Date($('aStart').value).toISOString(),
          notes: $('aNotes').value.trim(),
        },
        getEmail()
      )
      toast('Appointment saved')
      await reload(false)
      openApptForm(date)
    } catch (e) {
      toast('Failed: ' + e.message)
    }
  }
}

/* ---------------- To-Do ---------------- */
function renderTodo(v) {
  const openTasks = state.tasks.filter((t) => String(t.done).toUpperCase() !== 'TRUE')
  v.innerHTML = `
    <div class="grid gap-6 lg:grid-cols-2">
      <section class="card p-6">
        <h2 class="text-lg font-600">Needs action <span class="text-sm font-400 text-muted">(${items.length})</span></h2>
        <ul class="mt-4 space-y-2">
          ${
            items
              .map(
                (it) => `<li class="flex items-start gap-3 rounded-lg border border-ink/5 p-3 sla-${it.severity}">
            ${sevDot[it.severity]}
            <div class="min-w-0 flex-1">
              <p class="text-sm font-600">${esc(it.title)}</p>
              <p class="text-xs text-muted">${esc(it.detail)}</p>
            </div>
            <select data-snooze="${esc(it.key)}" data-lead="${esc(it.leadId || '')}" class="rounded border border-ink/15 px-1 py-0.5 text-xs">
              <option value="">snooze…</option>
              <option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option>
            </select>
          </li>`
              )
              .join('') || '<li class="text-sm text-muted">All clear 🎉</li>'
          }
        </ul>
      </section>
      <section class="card p-6">
        <h2 class="text-lg font-600">Manual tasks <span class="text-sm font-400 text-muted">(${openTasks.length})</span></h2>
        <div class="mt-4 flex gap-2">
          <input id="tTitle" placeholder="New task…" class="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm"/>
          <input id="tDue" type="date" class="rounded-lg border border-ink/15 px-2 py-2 text-sm"/>
          <button id="tAdd" class="btn-primary">Add</button>
        </div>
        <ul id="taskList" class="mt-4 space-y-2">
          ${
            openTasks
              .map(
                (t) => `<li class="flex items-center gap-3 rounded-lg border border-ink/5 p-3">
            <input type="checkbox" data-done="${t._row}" data-lead="${esc(t.lead_id || '')}" class="h-4 w-4"/>
            <div class="flex-1">
              <p class="text-sm font-600">${esc(t.title)}</p>
              ${t.due_date ? `<p class="text-xs text-muted">due ${fmtDate(t.due_date)}</p>` : ''}
            </div>
          </li>`
              )
              .join('') || '<li class="text-sm text-muted">No open tasks</li>'
          }
        </ul>
      </section>
    </div>`

  v.querySelectorAll('[data-snooze]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      const days = +sel.value
      if (!days) return
      const until = new Date(Date.now() + days * 864e5).toISOString()
      try {
        await addSnooze(sel.dataset.snooze, sel.dataset.lead, until, getEmail())
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
        await setTaskDone(+cb.dataset.done, cb.checked, getEmail(), cb.dataset.lead)
        toast('Updated')
        await reload(false)
      } catch (e) {
        toast('Failed: ' + e.message)
      }
    })
  )
}

start()
