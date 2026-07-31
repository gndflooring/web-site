// Google Identity Services (token model) — browser-only OAuth for a static site.
import { CLIENT_ID, SCOPES, ALLOWED_EMAILS } from './config.js'

const STORE_KEY = 'gnd_admin_token'
let tokenClient = null
let session = null // { access_token, expiry, email }

function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null')
    if (s && s.access_token && s.expiry > Date.now()) return s
  } catch {
    /* ignore */
  }
  return null
}

export function logDiagnosticTokens() {
  const gToken = getToken()
  const ghTok = sessionStorage.getItem('gnd_gh_token') || ''
  const payload = {
    sheetId: SPREADSHEET_ID,
    googleToken: gToken || '',
    githubToken: ghTok || '',
  }
  const cmd = `node scripts/verify-full-system.js ${gToken ? `--google-token "${gToken}"` : ''} ${ghTok ? `--github-token "${ghTok}"` : ''} --sheet-id "${SPREADSHEET_ID}"`.replace(/\s+/g, ' ').trim()

  window.__gndDiagnosticConfig = { ...payload, command: cmd }
  window.__getGndTokens = () => JSON.stringify(payload, null, 2)

  console.log('\n===========================================================')
  console.log('🔑 [TEMPORARY DIAGNOSTIC TOKENS FOR TESTING]')
  console.log('Google Token :', gToken || '(none)')
  console.log('GitHub Token :', ghTok || '(none)')
  console.log('\nJSON Payload for Test Script:')
  console.log(JSON.stringify(payload, null, 2))
  console.log('\nDirect Command to Run Test Script:')
  console.log(cmd)
  console.log('===========================================================\n')
}

function saveSession(s) {
  session = s
  sessionStorage.setItem(STORE_KEY, JSON.stringify(s))
  logDiagnosticTokens()
}

export function clearSession() {
  session = null
  sessionStorage.removeItem(STORE_KEY)
}

export function getEmail() {
  return session?.email || null
}

export function getToken() {
  if (session && session.expiry > Date.now()) return session.access_token
  return null
}

function initClient() {
  if (tokenClient) return
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {}, // set per-request
  })
}

function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    initClient()
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error))
      resolve(resp)
    }
    try {
      tokenClient.requestAccessToken({ prompt })
    } catch (e) {
      reject(e)
    }
  })
}

async function fetchEmail(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) throw new Error('Could not read Google profile')
  const j = await r.json()
  return (j.email || '').toLowerCase()
}

function isEmailAllowed(email) {
  if (!ALLOWED_EMAILS.length) return true
  const target = (email || '').trim().toLowerCase()
  return ALLOWED_EMAILS.some((a) => a.trim().toLowerCase() === target)
}

/** Interactive sign-in. Throws on failure or unauthorized email. */
export async function signIn() {
  const resp = await requestToken('consent')
  const rawEmail = await fetchEmail(resp.access_token)
  const email = (rawEmail || '').trim().toLowerCase()
  if (!isEmailAllowed(email)) {
    console.error('[AUTH ERROR] Email not allowed:', { email, ALLOWED_EMAILS })
    throw Object.assign(new Error(`${email} is not authorized for this console.`), {
      code: 'UNAUTHORIZED',
    })
  }
  saveSession({
    access_token: resp.access_token,
    expiry: Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60_000,
    email,
  })
  return email
}

/** Resume a cached session if the token is still valid. */
export async function resume() {
  const s = loadSession()
  if (!s) return null
  session = s
  logDiagnosticTokens()
  return s.email
}

/** Silent re-auth (no prompt) — used when the token expires mid-session. */
export async function refreshSilently() {
  const resp = await requestToken('')
  const prev = session || loadSession()
  const rawEmail = prev?.email || (await fetchEmail(resp.access_token))
  const email = (rawEmail || '').trim().toLowerCase()
  if (!isEmailAllowed(email)) {
    clearSession()
    throw Object.assign(new Error('Session no longer authorized.'), { code: 'UNAUTHORIZED' })
  }
  saveSession({
    access_token: resp.access_token,
    expiry: Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60_000,
    email,
  })
  return resp.access_token
}

export function signOut() {
  const t = getToken()
  if (t && google?.accounts?.oauth2) {
    try {
      google.accounts.oauth2.revoke(t, () => {})
    } catch {
      /* ignore */
    }
  }
  clearSession()
}
