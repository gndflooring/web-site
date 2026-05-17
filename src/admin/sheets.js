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
    `${TABS.TRACKING}!A:F`,
    `${TABS.ACTIVITY}!A:G`,
    `${TABS.SCHEDULE}!A:H`,
    `${TABS.TASKS}!A:H`,
    `${TABS.SNOOZES}!A:E`,
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

  const trackMap = {}
  tracking.forEach((t) => (trackMap[t.id] = t))

  const records = leads
    .filter((l) => l.id) // ignore any not-yet-backfilled rows
    .map((l) => ({ lead: l, track: trackMap[l.id] || null }))

  return { leads, tracking, activity, schedule, tasks, snoozes, trackMap, records }
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
  const prev = prevTrack || { status: '', tags: '', notes: '' }
  const next = {
    id,
    status: patch.status ?? prev.status ?? 'New',
    tags: patch.tags ?? prev.tags ?? '',
    notes: patch.notes ?? prev.notes ?? '',
    updated_at: nowIso(),
    updated_by: actor,
  }
  const values = [next.id, next.status, next.tags, next.notes, next.updated_at, next.updated_by]
  if (prevTrack && prevTrack._row) await updateRow(TABS.TRACKING, prevTrack._row, values)
  else await appendRow(TABS.TRACKING, values)

  for (const f of ['status', 'tags', 'notes']) {
    if (patch[f] !== undefined && (prev[f] || '') !== next[f]) {
      await appendActivity(id, actor, `${f} changed`, prev[f] || '', next[f])
    }
  }
  return next
}

export async function addAppointment(appt, actor) {
  const appt_id = crypto.randomUUID()
  await appendRow(TABS.SCHEDULE, [
    appt_id,
    appt.lead_id || '',
    appt.type || 'Other',
    appt.start,
    appt.end || '',
    appt.notes || '',
    actor,
    nowIso(),
  ])
  if (appt.lead_id) {
    await appendActivity(appt.lead_id, actor, 'appointment added', '', `${appt.type} @ ${appt.start}`)
  }
  return appt_id
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
