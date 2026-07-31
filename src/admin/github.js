// GitHub: device-flow connect (via the stateless Apps Script JSONP relay)
// + Git Data commit/merge engine. The user authenticates with their own
// GitHub account; the token lives only in sessionStorage; nothing is stored
// server-side. All repo writes go browser → api.github.com as the user.

import { logDiagnosticTokens } from './auth.js'

const CLIENT_ID = __GITHUB_CLIENT_ID__
const REPO = __GITHUB_REPO__ // "owner/repo"
const RELAY = __SHEETS_URL__ // existing Apps Script /exec (also serves the JSONP relay)
const DRAFT = 'content-draft'
const BASE = 'main'
const API = 'https://api.github.com'
const TOKEN_KEY = 'gnd_gh_token'

export const ghConfigured = () => !!CLIENT_ID && !!RELAY && !!REPO
export const ghToken = () => sessionStorage.getItem(TOKEN_KEY) || ''
export const ghConnected = () => !!ghToken()
export function ghDisconnect() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem('gnd_gh_user')
}
export const ghUser = () => sessionStorage.getItem('gnd_gh_user') || ''

/* ---------- JSONP to the relay (GitHub device endpoints lack CORS) ---------- */
let jsonpN = 0
let relayVerified = false

async function verifyRelay() {
  if (relayVerified) return
  if (!RELAY) throw new Error('SHEETS_URL (Apps Script relay) is not configured.')
  try {
    const res = await fetch(`${RELAY}?gh=ping`, { method: 'GET', redirect: 'follow' })
    const text = await res.text()
    if (text.includes('ServiceLogin') || text.includes('accounts.google.com') || (text.includes('<!DOCTYPE html>') && !text.includes('gnd github device relay'))) {
      throw new Error(
        'Apps Script relay configuration error: Google redirected to login. In Google Apps Script, click Deploy -> Manage Deployments and set "Who has access" to "Anyone".'
      )
    }
    relayVerified = true
  } catch (err) {
    if (err.message.includes('Apps Script relay configuration error')) throw err
  }
}

function jsonp(params) {
  return new Promise((resolve, reject) => {
    verifyRelay()
      .then(() => {
        const cb = `__ghcb_${Date.now()}_${jsonpN++}`
        const s = document.createElement('script')
        let cleaned = false

        function cleanup() {
          if (cleaned) return
          cleaned = true
          clearTimeout(to)
          // Keep a temporary no-op handler so late or timed-out JSONP responses don't throw Uncaught ReferenceError
          window[cb] = () => {
            delete window[cb]
          }
          setTimeout(() => {
            if (window[cb]) delete window[cb]
          }, 30000)
          s.remove()
        }

        const to = setTimeout(() => {
          cleanup()
          reject(new Error('Relay timeout — Google Apps Script did not respond in time.'))
        }, 20000)

        window[cb] = (data) => {
          cleanup()
          delete window[cb]
          resolve(data)
        }

        const qs = new URLSearchParams({ ...params, callback: cb }).toString()
        s.src = `${RELAY}?${qs}`
        s.onerror = () => {
          cleanup()
          reject(new Error('Relay unreachable — Google Apps Script endpoint failed or redirected to Google Login.'))
        }
        document.head.appendChild(s)
      })
      .catch(reject)
  })
}

/** Start device flow. Returns { user_code, verification_uri, device_code, interval, expires_in }. */
export async function ghStartDeviceFlow() {
  const r = await jsonp({ gh: 'device_code', client_id: CLIENT_ID, scope: 'repo' })
  if (r.error) throw new Error(r.error_description || r.error)
  if (!r.device_code) throw new Error('No device code from GitHub')
  return r
}

/** Poll until the user authorizes. Resolves with the access token (also stored). */
export async function ghPollToken(deviceCode, interval, expiresIn, onTick) {
  const stepMs = Math.max(5, Number(interval) || 5) * 1000
  const deadline = Date.now() + (Number(expiresIn) || 900) * 1000
  let waitMs = stepMs
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, waitMs))
    const r = await jsonp({ gh: 'poll', client_id: CLIENT_ID, device_code: deviceCode })
    if (r.access_token) {
      sessionStorage.setItem(TOKEN_KEY, r.access_token)
      try {
        const me = await ghApi('/user')
        sessionStorage.setItem('gnd_gh_user', me.login || '')
      } catch {
        /* ignore */
      }
      logDiagnosticTokens()
      return r.access_token
    }
    if (r.error === 'slow_down') waitMs += 5000
    else if (r.error === 'authorization_pending') waitMs = stepMs
    else if (r.error) throw new Error(r.error_description || r.error)
    if (onTick) onTick()
  }
  throw new Error('Authorization timed out — try Connect again')
}

/* ---------- GitHub REST (api.github.com is CORS-OK with a token) ---------- */
async function ghApi(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${ghToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401) {
    ghDisconnect()
    throw new Error('GitHub session expired — reconnect')
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`GitHub ${res.status}: ${t.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}

const b64ToUtf8 = (b64) => {
  const bin = atob(String(b64).replace(/\s/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Ensure the content-draft branch exists (fork from main if missing). Returns true if draft exists. */
export async function ghEnsureDraft() {
  try {
    await ghApi(`/repos/${REPO}/git/ref/heads/${DRAFT}`)
    return true
  } catch (e) {
    if (!/GitHub 404/.test(e.message)) return false
  }
  try {
    const main = await ghApi(`/repos/${REPO}/git/ref/heads/${BASE}`)
    await ghApi(`/repos/${REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${DRAFT}`, sha: main.object.sha }),
    })
    return true
  } catch (e) {
    console.warn('Draft branch creation unavailable (using main branch):', e.message)
    return false
  }
}

/** Read the current site.json from content-draft (fallback main). Returns parsed object or null. */
export async function ghLoadSiteJson() {
  for (const ref of [DRAFT, BASE]) {
    try {
      const r = await ghApi(
        `/repos/${REPO}/contents/${encodeURIComponent('src/content/site.json')}?ref=${ref}`
      )
      return JSON.parse(b64ToUtf8(r.content))
    } catch (e) {
      if (!/GitHub 404/.test(e.message) && !/GitHub 403/.test(e.message)) throw e
    }
  }
  return null
}

/**
 * Atomic commit to content-draft (or main if draft unavailable): site.json (utf-8) + any images (base64).
 * images: [{ path, base64 }]
 */
export async function ghCommitDraft(siteObj, images, message) {
  const hasDraft = await ghEnsureDraft()
  const targetBranch = hasDraft ? DRAFT : BASE

  const ref = await ghApi(`/repos/${REPO}/git/ref/heads/${targetBranch}`)
  const headSha = ref.object.sha
  const headCommit = await ghApi(`/repos/${REPO}/git/commits/${headSha}`)

  const tree = []
  const jsonBlob = await ghApi(`/repos/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: JSON.stringify(siteObj, null, 2) + '\n', encoding: 'utf-8' }),
  })
  tree.push({ path: 'src/content/site.json', mode: '100644', type: 'blob', sha: jsonBlob.sha })

  for (const img of images || []) {
    const blob = await ghApi(`/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: img.base64, encoding: 'base64' }),
    })
    tree.push({ path: img.path, mode: '100644', type: 'blob', sha: blob.sha })
  }

  const newTree = await ghApi(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
  })
  const commit = await ghApi(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: message || 'Update site content',
      tree: newTree.sha,
      parents: [headSha],
    }),
  })
  await ghApi(`/repos/${REPO}/git/refs/heads/${targetBranch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })
  return commit.sha
}

/** Merge content-draft → main (existing CI/CD deploys), then resync draft. */
export async function ghPublish(message) {
  let hasDraft = false
  try {
    await ghApi(`/repos/${REPO}/git/ref/heads/${DRAFT}`)
    hasDraft = true
  } catch (e) {
    hasDraft = false
  }

  if (!hasDraft) {
    const main = await ghApi(`/repos/${REPO}/git/ref/heads/${BASE}`)
    return { merged: true, sha: main.object.sha }
  }

  let merged = null
  try {
    merged = await ghApi(`/repos/${REPO}/merges`, {
      method: 'POST',
      body: JSON.stringify({ base: BASE, head: DRAFT, commit_message: message || 'Publish site content' }),
    })
  } catch (e) {
    if (/GitHub 409/.test(e.message)) throw new Error('Merge conflict — main changed; reload and try again')
    throw e
  }
  // resync draft to main HEAD so the next cycle is clean
  try {
    const main = await ghApi(`/repos/${REPO}/git/ref/heads/${BASE}`)
    await ghApi(`/repos/${REPO}/git/refs/heads/${DRAFT}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: main.object.sha, force: true }),
    })
  } catch (e) {}
  return { merged: !!merged, sha: '' }
}

/** Latest deploy workflow run on main. */
export async function ghDeployStatus() {
  const r = await ghApi(`/repos/${REPO}/actions/runs?branch=${BASE}&per_page=1`)
  const run = (r.workflow_runs || [])[0]
  return run
    ? { status: run.status, conclusion: run.conclusion, url: run.html_url, sha: run.head_sha }
    : null
}

/** Downscale an image File in-browser → { path, base64, preview } (JPEG). */
export function ghResizeImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('Could not read file'))
    fr.onload = () => {
      const im = new Image()
      im.onerror = () => reject(new Error('Invalid image'))
      im.onload = () => {
        let { width: w, height: h } = im
        const scale = Math.min(1, maxDim / Math.max(w, h))
        w = Math.round(w * scale)
        h = Math.round(h * scale)
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        cv.getContext('2d').drawImage(im, 0, 0, w, h)
        const dataUrl = cv.toDataURL('image/jpeg', quality)
        const base64 = dataUrl.split(',')[1]
        const slug =
          (file.name || 'photo')
            .replace(/\.[^.]+$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'photo'
        const path = `public/uploads/${Date.now()}-${slug}.jpg`
        resolve({ path, base64, preview: dataUrl, url: '/' + path.replace(/^public\//, '') })
      }
      im.src = fr.result
    }
    fr.readAsDataURL(file)
  })
}
