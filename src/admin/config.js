// PUBLIC build-time values (inlined by Vite `define`; see vite.config.js).
export const CLIENT_ID = __GOOGLE_OAUTH_CLIENT_ID__
export const SPREADSHEET_ID = __SHEETS_SPREADSHEET_ID__
export const ALLOWED_EMAILS = String(__ADMIN_ALLOWED_EMAILS__ || 'fabbari@gmail.com,gndflooringadmin@gmail.com')
  .split(',')
  .map((e) => e.replace(/['"\s]/g, '').toLowerCase())
  .filter(Boolean)

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ')

// Tab names. `LEADS` is the existing form sheet (no header row; positional).
export const TABS = {
  LEADS: 'FormResponses',
  TRACKING: 'Tracking',
  ACTIVITY: 'Activity',
  SCHEDULE: 'Schedule',
  TASKS: 'Tasks',
  SNOOZES: 'Snoozes',
  NOTES: 'Notes',
  ADDRESSES: 'Addresses',
  TAGS: 'Tags',
}

// FormResponses positional columns A..I (no header row).
export const LEAD_COLS = [
  'submittedAt',
  'name',
  'phone',
  'email',
  'service',
  'message',
  'source',
  'timestamp',
  'id',
]

// Header rows for auto-created tabs.
export const HEADERS = {
  [TABS.TRACKING]: ['id', 'status', 'tags', 'notes', 'updated_at', 'updated_by', 'title', 'address_id'],
  [TABS.ACTIVITY]: ['timestamp', 'id', 'actor', 'action', 'old_value', 'new_value', 'note'],
  [TABS.SCHEDULE]: ['appt_id', 'lead_id', 'type', 'start', 'end', 'notes', 'created_by', 'created_at', 'duration_min'],
  [TABS.TASKS]: ['task_id', 'lead_id', 'title', 'due_date', 'done', 'created_by', 'created_at', 'done_at'],
  [TABS.SNOOZES]: ['heuristic_key', 'lead_id', 'snooze_until', 'by', 'created_at'],
  [TABS.NOTES]: ['note_id', 'lead_id', 'timestamp', 'author', 'text', 'appt_id', 'tags'],
  [TABS.ADDRESSES]: ['address_id', 'label', 'address', 'notes', 'created_by', 'created_at'],
  [TABS.TAGS]: ['tag', 'color'],
}

// Default palette offered when assigning a colour to a new tag.
export const TAG_PALETTE = [
  '#2f7cb5', '#c49a5e', '#2e7d54', '#b4434e', '#7b54c4',
  '#c2701f', '#3a8fa0', '#9c5a8a', '#5d6b75', '#1d3f5b',
]

export const PIPELINE = [
  'New',
  'Contacted',
  'Site Visit',
  'Quoted',
  'Scheduled',
  'Completed',
  'Lost',
]

export const APPT_TYPES = ['Site Visit', 'Callback', 'Install', 'Other']

// Heuristic thresholds (hours/days) — tune freely.
export const RULES = {
  NEW_STALE_H: 24, // New & no contact after this many hours
  NEW_URGENT_H: 72, // …becomes "urgent" after this many hours
  CONTACTED_STALE_D: 3, // Contacted, no upcoming appt & no change in N days
  QUOTED_STALE_D: 7, // Quoted & no change in N days
}
