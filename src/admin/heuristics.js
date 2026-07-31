// "Needs action" engine: derives live work items from joined Sheet state.
import { RULES } from './config.js'

const H = 3600_000
const D = 24 * H

const parseDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d) ? null : d
}
const leadDate = (l) => parseDate(l.submittedAt) || parseDate(l.timestamp)

const SEV_WEIGHT = { urgent: 0, due: 1, normal: 2 }

function activeSnoozes(snoozes, now) {
  const set = new Set()
  for (const s of snoozes) {
    const until = parseDate(s.snooze_until)
    if (until && until.getTime() > now) set.add(s.heuristic_key)
  }
  return set
}

/**
 * @returns array of { key, rule, severity, title, detail, leadId, lead, task }
 * sorted by severity then age. Snoozed keys are excluded.
 */
export function computeNeedsAction(state, now = Date.now()) {
  const { records, schedule, tasks, snoozes } = state
  const snoozed = activeSnoozes(snoozes, now)
  const items = []

  const apptByLead = {}
  for (const a of schedule) {
    if (!a.lead_id) continue
    ;(apptByLead[a.lead_id] ||= []).push(a)
  }

  const deletedIds = new Set(records.filter((r) => r.isDeleted || r.track?.status === 'Deleted').map((r) => r.lead.id))

  for (const rec of records) {
    if (rec.isDeleted || rec.track?.status === 'Deleted') continue
    const { lead, track } = rec
    const id = lead.id
    const status = track?.status || ''
    const ld = leadDate(lead)
    const ageH = ld ? (now - ld.getTime()) / H : 0
    const updated = parseDate(track?.updated_at)
    const sinceUpdateD = updated ? (now - updated.getTime()) / D : Infinity
    const appts = apptByLead[id] || []
    const upcoming = appts.some((a) => {
      const s = parseDate(a.start)
      return s && s.getTime() > now
    })

    const push = (rule, severity, title, detail) => {
      const key = `${rule}:${id}`
      if (snoozed.has(key)) return
      items.push({ key, rule, severity, title, detail, leadId: id, lead })
    }

    if (!track) {
      push(
        'untracked',
        ageH > RULES.NEW_URGENT_H ? 'urgent' : 'due',
        'Untriaged lead',
        `${lead.name || 'Lead'} — no status yet (${Math.round(ageH)}h old)`
      )
    } else if (status === 'New' && ageH > RULES.NEW_STALE_H) {
      push(
        'new_stale',
        ageH > RULES.NEW_URGENT_H ? 'urgent' : 'due',
        'New, not contacted',
        `${lead.name || 'Lead'} waiting ${Math.round(ageH)}h`
      )
    }

    if (status === 'Contacted' && !upcoming && sinceUpdateD > RULES.CONTACTED_STALE_D) {
      push(
        'contacted_stalled',
        sinceUpdateD > RULES.CONTACTED_STALE_D * 2 ? 'urgent' : 'due',
        'Contacted but stalled',
        `${lead.name || 'Lead'} — no next step in ${Math.round(sinceUpdateD)}d`
      )
    }

    const notAdvanced = ['New', 'Contacted', 'Site Visit', 'Quoted', 'Scheduled']
    for (const a of appts) {
      const s = parseDate(a.start)
      if (s && s.getTime() < now && notAdvanced.includes(status)) {
        push(
          'appt_passed',
          'urgent',
          'Appointment passed',
          `${a.type} for ${lead.name || 'lead'} on ${s.toLocaleString()} — update status`
        )
        break
      }
    }

    if (status === 'Quoted' && sinceUpdateD > RULES.QUOTED_STALE_D) {
      push(
        'quoted_stale',
        sinceUpdateD > RULES.QUOTED_STALE_D * 2 ? 'urgent' : 'due',
        'Quote going cold',
        `${lead.name || 'Lead'} quoted ${Math.round(sinceUpdateD)}d ago — follow up`
      )
    }
  }

  // Overdue manual tasks
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  for (const t of tasks) {
    if (String(t.done).toUpperCase() === 'TRUE') continue
    if (t.lead_id && deletedIds.has(t.lead_id)) continue
    const due = parseDate(t.due_date)
    if (due && due.getTime() < today.getTime()) {
      const key = `task:${t.task_id}`
      if (snoozed.has(key)) continue
      items.push({
        key,
        rule: 'task_overdue',
        severity: 'urgent',
        title: 'Task overdue',
        detail: `${t.title} (due ${t.due_date})`,
        leadId: t.lead_id || '',
        task: t,
      })
    }
  }

  items.sort(
    (a, b) =>
      SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity] ||
      a.title.localeCompare(b.title)
  )
  return items
}

/** Per-lead worst severity, for Board card edges. */
export function severityByLead(items) {
  const m = {}
  for (const it of items) {
    if (!it.leadId) continue
    if (!m[it.leadId] || SEV_WEIGHT[it.severity] < SEV_WEIGHT[m[it.leadId]]) {
      m[it.leadId] = it.severity
    }
  }
  return m
}
