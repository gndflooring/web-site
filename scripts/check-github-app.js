#!/usr/bin/env node
/**
 * G&D Flooring — GitHub App permission audit for the Website CMS.
 *
 * The CMS commits with a *user-to-server* token from a GitHub App device
 * flow, so a write can be refused for three separate reasons that look
 * identical from the browser ("Resource not accessible by integration"):
 *
 *   1. the App does not request Contents: Read and write
 *   2. the installation has not accepted a newer permission set
 *   3. the App is not installed on this repository
 *
 * This script authorises exactly as the CMS does, prints what the
 * installation actually granted, and then performs the same API calls the
 * editor makes so you can see which one fails.
 *
 * Usage
 *   node scripts/check-github-app.js                # device flow (recommended)
 *   node scripts/check-github-app.js --token ghp_…  # audit a PAT instead
 *   node scripts/check-github-app.js --app-id 123 --key ./app.private-key.pem
 *   node scripts/check-github-app.js --client-id Iv23… --repo owner/name
 *
 * Read-only apart from one dangling blob (unreferenced, garbage-collected by
 * GitHub). Nothing is committed and no branch is touched.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const API = 'https://api.github.com'

/* ---------- tiny helpers ---------- */
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[36m',
}
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`)
const bad = (m) => console.log(`  ${C.red}✗${C.reset} ${m}`)
const warn = (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`)
const info = (m) => console.log(`  ${C.dim}·${C.reset} ${m}`)
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`)

function parseEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return {}
  const env = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null
}

async function api(pathname, { token, jwt, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gnd-cms-permission-audit',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(token ? { Authorization: `token ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, ok: res.ok, json, text, headers: res.headers }
}

/* ---------- config ---------- */
const env = parseEnv()
const REPO =
  arg('--repo') || env.SITE_GITHUB_REPO || env.GH_CMS_REPO || env.GH_REPO || env.GITHUB_REPO || 'gndflooring/web-site'
const CLIENT_ID =
  arg('--client-id') ||
  env.SITE_GITHUB_CLIENT_ID ||
  env.GH_CMS_CLIENT_ID ||
  env.GH_CLIENT_ID ||
  env.GITHUB_CLIENT_ID ||
  'Iv23liyTHuNvzEsB9Rtt' // the id shipped in the deployed admin bundle
const PAT = arg('--token') || (process.argv.includes('--use-push-token') ? env.GITHUB_PUSH_TOKEN : null)
const APP_ID = arg('--app-id') || env.GH_APP_ID
const KEY_PATH = arg('--key') || env.GH_APP_PRIVATE_KEY_PATH

console.log(`\n${C.bold}GitHub App permission audit — ${REPO}${C.reset}`)
console.log(`${C.dim}client id ${CLIENT_ID}${C.reset}`)

if (/^Iv1\.|^Iv23/.test(CLIENT_ID)) {
  info('client id format → GitHub App (user-to-server tokens; permissions come from the App + installation)')
} else if (CLIENT_ID) {
  info('client id format → OAuth App (classic scopes)')
}

/* ---------- 1. device flow, exactly like the CMS ---------- */
async function deviceFlow() {
  head('1. Authorising via the device flow (same as the CMS)')
  const start = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: 'repo' }),
  }).then((r) => r.json())

  if (start.error) {
    bad(`device code request failed: ${start.error_description || start.error}`)
    return null
  }

  console.log(`\n    Open ${C.blue}${start.verification_uri}${C.reset}`)
  console.log(`    Enter code: ${C.bold}${start.user_code}${C.reset}\n`)
  process.stdout.write('    waiting')

  const deadline = Date.now() + (start.expires_in || 900) * 1000
  const interval = Math.max(5, start.interval || 5) * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    process.stdout.write('.')
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: start.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    }).then((x) => x.json())
    if (r.access_token) {
      console.log('')
      ok('authorised')
      return r.access_token
    }
    if (r.error && r.error !== 'authorization_pending' && r.error !== 'slow_down') {
      console.log('')
      bad(`${r.error}: ${r.error_description || ''}`)
      return null
    }
  }
  console.log('')
  bad('timed out')
  return null
}

/* ---------- 2. what the installation actually granted ---------- */
async function reportInstallations(token) {
  head('2. Installations visible to this token')
  const r = await api('/user/installations', { token })
  if (!r.ok) {
    warn(`could not list installations (${r.status}: ${r.json?.message || ''})`)
    if (r.status === 403) info('a classic PAT cannot read this — rerun without --token to use the device flow')
    return null
  }
  const list = r.json.installations || []
  if (!list.length) {
    bad('the App is not installed anywhere for this account')
    return null
  }
  let match = null
  for (const inst of list) {
    console.log(`\n  ${C.bold}${inst.app_slug}${C.reset} ${C.dim}(installation ${inst.id}, ${inst.repository_selection})${C.reset}`)
    const perms = inst.permissions || {}
    const keys = Object.keys(perms).sort()
    if (!keys.length) info('no repository permissions')
    for (const k of keys) {
      const line = `${k}: ${perms[k]}`
      if (k === 'contents') (perms[k] === 'write' ? ok : bad)(line + (perms[k] === 'write' ? '' : '  ← the CMS needs write'))
      else info(line)
    }
    // which repositories does this installation cover?
    const repos = await api(`/user/installations/${inst.id}/repositories?per_page=100`, { token })
    if (repos.ok) {
      const names = (repos.json.repositories || []).map((x) => x.full_name)
      const covers = inst.repository_selection === 'all' || names.includes(REPO)
      ;(covers ? ok : bad)(
        covers ? `covers ${REPO}` : `does NOT cover ${REPO} (has: ${names.slice(0, 6).join(', ') || 'none'})`
      )
      if (covers) match = { inst, perms }
    }
  }
  return match
}

/* ---------- 3. the App's own configuration (needs the private key) ---------- */
async function reportAppConfig() {
  if (!APP_ID || !KEY_PATH) return
  head('3. App configuration (from the private key)')
  if (!fs.existsSync(KEY_PATH)) return bad(`private key not found at ${KEY_PATH}`)
  const key = fs.readFileSync(KEY_PATH, 'utf8')
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: APP_ID })}`
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')
  const jwt = `${unsigned}.${sig}`

  const app = await api('/app', { jwt })
  if (!app.ok) return bad(`GET /app → ${app.status}: ${app.json?.message || ''}`)
  info(`name: ${app.json.name} (slug ${app.json.slug})`)
  info(`owner: ${app.json.owner?.login}`)
  console.log(`  ${C.dim}requested repository permissions:${C.reset}`)
  for (const [k, v] of Object.entries(app.json.permissions || {})) {
    if (k === 'contents') (v === 'write' ? ok : bad)(`contents: ${v}  ← must be write`)
    else info(`${k}: ${v}`)
  }

  const inst = await api(`/repos/${REPO}/installation`, { jwt })
  if (inst.ok) {
    ok(`installed on ${REPO} (installation ${inst.json.id})`)
    const granted = inst.json.permissions || {}
    if (granted.contents !== 'write')
      bad(`installation granted contents: ${granted.contents || 'none'} — the permission update has not been accepted`)
    else ok('installation granted contents: write')
  } else {
    bad(`not installed on ${REPO} (${inst.status}: ${inst.json?.message || ''})`)
  }
}

/* ---------- 4. the calls the editor actually makes ---------- */
async function probeWrites(token) {
  head('4. Live probes — the exact calls Save Draft makes')

  const repo = await api(`/repos/${REPO}`, { token })
  ;(repo.ok ? ok : bad)(`GET /repos/${REPO} → ${repo.status}`)
  if (!repo.ok) return

  for (const branch of ['main', 'content-draft']) {
    const r = await api(`/repos/${REPO}/git/ref/heads/${branch}`, { token })
    if (r.ok) info(`${branch} @ ${r.json.object.sha.slice(0, 7)}`)
    else warn(`${branch}: ${r.status} ${r.json?.message || ''}`)
  }

  // Dangling blob: never referenced by a tree, so GitHub garbage-collects it.
  const blob = await api(`/repos/${REPO}/git/blobs`, {
    token,
    method: 'POST',
    body: { content: 'gnd cms permission probe', encoding: 'utf-8' },
  })
  if (blob.ok) ok('POST /git/blobs → 201 (Git Data writes allowed — Save Draft will work)')
  else {
    bad(`POST /git/blobs → ${blob.status}: ${blob.json?.message || ''}`)
    if (blob.status === 403) info('this is the failure you saw in the editor')
  }

  // The fallback path added to src/admin/github.js — read only, no PUT.
  const contents = await api(`/repos/${REPO}/contents/src/content/site.json?ref=main`, { token })
  ;(contents.ok ? ok : bad)(`GET /contents/src/content/site.json → ${contents.status}`)

  return blob.ok
}

/* ---------- run ---------- */
const token = PAT || (await deviceFlow())
if (!token) {
  console.log(`\n${C.red}No token — cannot audit.${C.reset}\n`)
  process.exit(1)
}
if (PAT) info('auditing the supplied token (not the App) — installation data will be unavailable')

const match = await reportInstallations(token)
await reportAppConfig()
const writesWork = await probeWrites(token)

/* ---------- verdict ---------- */
head('Verdict')
if (writesWork) {
  ok('This token can commit. If the editor still fails, Disconnect and reconnect so it picks up a fresh token.')
} else if (match && match.perms?.contents !== 'write') {
  bad('The installation grants contents: ' + (match.perms?.contents || 'none') + ' — that is the blocker.')
  console.log(`
  Fix, in order:
    1. Settings → Developer settings → GitHub Apps → [app] → Permissions & events
       → Repository permissions → Contents: Read and write
    2. Settings → Applications → Installed GitHub Apps → [app]
       → accept the pending permission request (raising permissions does NOT
         apply to existing installations until it is approved)
    3. Confirm the installation covers ${REPO}
    4. In the CMS: Disconnect, then Connect GitHub again`)
} else if (!match) {
  bad(`No installation covering ${REPO} was found for this account.`)
  console.log(`\n  Install the App on ${REPO}: Settings → Applications → Installed GitHub Apps → [app] → Configure`)
} else {
  warn('Permissions look right but the write probe failed — check org-level third-party access restrictions.')
}
console.log('')
