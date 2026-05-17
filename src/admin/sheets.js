// Google Sheets REST client (browser, user OAuth token). sheets.googleapis.com
// supports CORS, so direct calls work from the static site.
import { SPREADSHEET_ID, TABS, HEADERS, LEAD_COLS } from './config.js'
import { getToken, refreshSilently } from './auth.js'

const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`
const sheetIds = {} // title -> sheetId

async function gFetch(url, opts = {}, retry = true) {
  const token = getToken()
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401 && retry) {
    await refreshSilently()
    return gFetch(url, opts, false)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}

const a1 = (s) => encodeURIComponent(s)

/** Ensure every managed tab exists with its header row; cache sheetIds. */
export async function ensureTabs() {
  const meta = await gFetch(`${BASE}?fields=sheets(properties(sheetId,title))`)
  const existing = new Set()
  for (const s of meta.sheets || []) {
    existing.add(s.properties.title)
    sheetIds[s.properties.title] = s.properties.sheetId
  }
  const toCreate = Object.values(TABS).filter(
    (t) => t !== TABS.LEADS && !existing.has(t)
  )
  if (toCreate.length) {
    const r = await gFetch(`${BASE}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    })
    for (const rep of r.replies || []) {
      const p = rep.addSheet?.properties
      if (p) sheetIds[p.title] = p.sheetId
    }
    for (const title of toCreate) {
      await gFetch(`${BASE}/values/${a1(`${title}!A1`)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [HEADERS[title]] }),
      })
    }
  }
  // Header reconcile: extend headers of existing managed tabs (e.g. Tracking
  // gaining title/address_id) WITHOUT reordering existing columns.
  const managed = Object.values(TABS).filter((t) => t !== TABS.LEADS && existing.has(t))
  if (managed.length) {
    const hq = managed.map((t) => `ranges=${a1(`${t}!1:1`)}`).join('&')
    const hd = await gFetch(`${BASE}/values:batchGet?${hq}&majorDimension=ROWS`)
    const hvr = hd.valueRanges || []
    for (let i = 0; i < managed.length; i++) {
      const title = managed[i]
      const cur = (hvr[i]?.values?.[0] || []).map(String)
      const want = HEADERS[title]
      const isPrefix = cur.every((c, idx) => c === want[idx])
      if (isPrefix && cur.length < want.length) {
        await gFetch(`${BASE}/values/${a1(`${title}!A1`)}?valueInputOption=RAW`, {
          method: 'PUT',
          body: JSON.stringify({ values: [want] }),
        })
      }
    }
  }

  if (!existing.has(TABS.LEADS) && sheetIds[TABS.LEADS] === undefined) {
    throw new Error(`Sheet tab "${TABS.LEADS}" not found in the spreadsheet.`)
  }
}

function rowsToObjects(rows, headers) {
  return (rows || []).map((r, i) => {
    const o = { _row: i + 2 } // +2: header is row 1, data starts row 2
    headers.forEach((h, c) => (o[h] = r[c] ?? ''))
    return o
  })
}

/** Read everything in one batch and join leads with their tracking record. */
export async function loadAll() {
  const ranges = [
    `${TABS.LEADS}!A:I`,
    `${TABS.TRACKING}!A:H`,
    `${TABS.ACTIVITY}!A:G`,
    `${TABS.SCHEDULE}!A:I`,
    `${TABS.TASKS}!A:H`,
    `${TABS.SNOOZES}!A:E`,
    `${TABS.NOTES}!A:G`,
    `${TABS.ADDRESSES}!A:F`,
  ]
  const q = ranges.map((r) => `ranges=${a1(r)}`).join('&')
  const data = await gFetch(`${BASE}/values:batchGet?${q}&majorDimension=ROWS`)
  const vr = data.valueRanges || []
  const get = (i) => vr[i]?.values || []

  // FormResponses has NO header row → positional, spreadsheet row = idx + 1
  const leads = get(0).map((r, i) => {
    const o = { _row: i + 1 }
    LEAD_COLS.forEach((k, c) => (o[k] = r[c] ?? ''))
    return o
  })

  const tracking = rowsToObjects(get(1).slice(1), HEADERS[TABS.TRACKING])
  const activity = rowsToObjects(get(2).slice(1), HEADERS[TABS.ACTIVITY])
  const schedule = rowsToObjects(get(3).slice(1), HEADERS[TABS.SCHEDULE])
  const tasks = rowsToObjects(get(4).slice(1), HEADERS[TABS.TASKS])
  const snoozes = rowsToObjects(get(5).slice(1), HEADERS[TABS.SNOOZES])

  const notes = rowsToObjects(get(6).slice(1), HEADERS[TABS.NOTES])
  const addresses = rowsToObjects(get(7).slice(1), HEADERS[TABS.ADDRESSES])

  const trackMap = {}
  tracking.forEach((t) => (trackMap[t.id] = t))
  const addrMap = {}
  addresses.forEach((a) => (addrMap[a.address_id] = a))
  const notesByLead = {}
  const notesByAppt = {}
  notes.forEach((n) => {
    ;(notesByLead[n.lead_id] ||= []).push(n)
    if (n.appt_id) (notesByAppt[n.appt_id] ||= []).push(n)
  })

  const records = leads
    .filter((l) => l.id) // ignore any not-yet-backfilled rows
    .map((l) => ({ lead: l, track: trackMap[l.id] || null }))

  return {
    leads,
    tracking,
    activity,
    schedule,
    tasks,
    snoozes,
    notes,
    addresses,
    trackMap,
    addrMap,
    notesByLead,
    notesByAppt,
    records,
  }
}

async function updateRow(tab, row, values) {
  const lastCol = String.fromCharCode(64 + values.length)
  await gFetch(
    `${BASE}/values/${a1(`${tab}!A${row}:${lastCol}${row}`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [values] }) }
  )
}

async function appendRow(tab, values) {
  await gFetch(
    `${BASE}/values/${a1(`${tab}!A:A`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [values] }) }
  )
}

async function deleteRow(tab, row) {
  const sheetId = sheetIds[tab]
  await gFetch(`${BASE}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
          },
        },
      ],
    }),
  })
}

const nowIso = () => new Date().toISOString()

export async function appendActivity(id, actor, action, oldV, newV, note = '') {
  await appendRow(TABS.ACTIVITY, [nowIso(), id, actor, action, oldV, newV, note])
}

/** Upsert one Tracking row and log every changed field to Activity. */
export async function saveTracking(id, patch, actor, prevTrack) {
  const prev = prevTrack || {}
  const next = {
    id,
    status: patch.status ?? prev.status ?? 'New',
    tags: patch.tags ?? prev.tags ?? '',
    notes: patch.notes ?? prev.notes ?? '',
    updated_at: nowIso(),
    updated_by: actor,
    title: patch.title ?? prev.title ?? '',
    address_id: patch.address_id ?? prev.address_id ?? '',
  }
  // Build the row in the tab's header order (robust to added columns).
  const values = HEADERS[TABS.TRACKING].map((h) => next[h] ?? '')
  if (prevTrack && prevTrack._row) await updateRow(TABS.TRACKING, prevTrack._row, values)
  else await appendRow(TABS.TRACKING, values)

  for (const f of ['status', 'tags', 'title']) {
    if (patch[f] !== undefined && (prev[f] || '') !== (next[f] || '')) {
      await appendActivity(id, actor, `${f} changed`, prev[f] || '', next[f] || '')
    }
  }
  if (patch.address_id !== undefined && (prev.address_id || '') !== (next.address_id || '')) {
    await appendActivity(id, actor, 'address changed', prev.address_id || '', next.address_id || '')
  }
  return next
}

const rowFor = (tab, obj) => HEADERS[tab].map((h) => obj[h] ?? '')

export async function addNote(lead_id, text, author, opts = {}) {
  const note_id = crypto.randomUUID()
  await appendRow(
    TABS.NOTES,
    rowFor(TABS.NOTES, {
      note_id,
      lead_id,
      timestamp: nowIso(),
      author,
      text,
      appt_id: opts.appt_id || '',
      tags: opts.tags || '',
    })
  )
  await appendActivity(lead_id, author, 'note added', '', text.slice(0, 80))
  return note_id
}

export async function updateNote(noteRow, fields, actor, prev = {}) {
  await updateRow(
    TABS.NOTES,
    noteRow,
    rowFor(TABS.NOTES, {
      note_id: prev.note_id,
      lead_id: prev.lead_id,
      timestamp: prev.timestamp,
      author: prev.author,
      text: fields.text ?? prev.text ?? '',
      appt_id: prev.appt_id || '',
      tags: fields.tags ?? prev.tags ?? '',
    })
  )
  if (prev.lead_id) await appendActivity(prev.lead_id, actor, 'note edited', '', String(fields.text || '').slice(0, 80))
}

export async function deleteNote(noteRow, leadId, actor) {
  await deleteRow(TABS.NOTES, noteRow)
  if (leadId) await appendActivity(leadId, actor, 'note deleted', '', '')
}

export async function addAddress(addr, actor) {
  const address_id = crypto.randomUUID()
  await appendRow(TABS.ADDRESSES, [
    address_id,
    addr.label || '',
    addr.address || '',
    addr.notes || '',
    actor,
    nowIso(),
  ])
  return address_id
}

const endFrom = (start, durationMin) =>
  start && durationMin
    ? new Date(new Date(start).getTime() + Number(durationMin) * 60000).toISOString()
    : ''

export async function addAppointment(appt, actor) {
  const appt_id = crypto.randomUUID()
  const duration_min = Number(appt.duration_min) || 60
  await appendRow(
    TABS.SCHEDULE,
    rowFor(TABS.SCHEDULE, {
      appt_id,
      lead_id: appt.lead_id || '',
      type: appt.type || 'Other',
      start: appt.start,
      end: endFrom(appt.start, duration_min),
      notes: appt.notes || '',
      created_by: actor,
      created_at: nowIso(),
      duration_min,
    })
  )
  if (appt.lead_id) {
    await appendActivity(appt.lead_id, actor, 'appointment added', '', `${appt.type} @ ${appt.start}`)
  }
  return appt_id
}

export async function updateAppointment(apptRow, fields, actor, prev = {}) {
  const duration_min = Number(fields.duration_min ?? prev.duration_min) || 60
  const start = fields.start ?? prev.start
  await updateRow(
    TABS.SCHEDULE,
    apptRow,
    rowFor(TABS.SCHEDULE, {
      appt_id: prev.appt_id,
      lead_id: fields.lead_id ?? prev.lead_id ?? '',
      type: fields.type ?? prev.type ?? 'Other',
      start,
      end: endFrom(start, duration_min),
      notes: prev.notes || '',
      created_by: prev.created_by || actor,
      created_at: prev.created_at || nowIso(),
      duration_min,
    })
  )
  const lid = fields.lead_id ?? prev.lead_id
  if (lid) await appendActivity(lid, actor, 'appointment updated', '', `${fields.type ?? prev.type} @ ${start}`)
}

export async function deleteAppointment(apptRow, leadId, actor, label) {
  await deleteRow(TABS.SCHEDULE, apptRow)
  if (leadId) await appendActivity(leadId, actor, 'appointment removed', label || '', '')
}

export async function addTask(task, actor) {
  const task_id = crypto.randomUUID()
  await appendRow(TABS.TASKS, [
    task_id,
    task.lead_id || '',
    task.title,
    task.due_date || '',
    'FALSE',
    actor,
    nowIso(),
    '',
  ])
  return task_id
}

export async function setTaskDone(taskRow, done, actor, leadId) {
  // Read the row, flip done + done_at, write back.
  const range = `${TABS.TASKS}!A${taskRow}:H${taskRow}`
  const cur = await gFetch(`${BASE}/values/${a1(range)}`)
  const r = (cur.values && cur.values[0]) || []
  r[4] = done ? 'TRUE' : 'FALSE'
  r[7] = done ? nowIso() : ''
  await updateRow(TABS.TASKS, taskRow, r.slice(0, 8))
  if (leadId) await appendActivity(leadId, actor, done ? 'task completed' : 'task reopened', '', r[2] || '')
}

export async function addSnooze(heuristic_key, lead_id, until, by) {
  await appendRow(TABS.SNOOZES, [heuristic_key, lead_id, until, by, nowIso()])
}
