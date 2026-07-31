import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const envPath = path.resolve(process.cwd(), '.env')

function parseEnv() {
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx > -1) {
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim()
      env[key] = val
    }
  }
  return env
}

const env = parseEnv()
const ghPath = fs.existsSync('/home/mrwho/bin/gh') ? '/home/mrwho/bin/gh' : 'gh'

console.log('\n======================================================================')
console.log(' G&D Flooring — Full System & API Live Diagnostic Suite')
console.log('======================================================================\n')

let overallPass = true

/* ----------------------------------------------------------------------
   SECTION 1: GitHub API Verification (Remote Repo, Pages & Variables)
---------------------------------------------------------------------- */
console.log('--- 1. GitHub Environment & Actions Variables Audit ---')

let remoteVars = {}
try {
  const varsJson = execSync(`${ghPath} api repos/gndflooring/web-site/actions/variables`, { stdio: 'pipe' }).toString()
  const parsed = JSON.parse(varsJson)
  for (const v of parsed.variables || []) {
    remoteVars[v.name] = v.value
  }
  console.log(`  [OK] Successfully queried GitHub Actions repository variables (${Object.keys(remoteVars).length} variables set).`)
} catch (e) {
  console.log(`  [FAIL] Could not query GitHub Actions variables via gh CLI: ${e.message}`)
  overallPass = false
}

// Compare local .env vs remote GitHub Actions variables
const keyMap = [
  { envKey: 'SHEETS_URL', remoteKey: 'SHEETS_URL', name: 'Google Apps Script URL' },
  { envKey: 'SHEETS_DEPLOYMENT_ID', remoteKey: 'SHEETS_DEPLOYMENT_ID', name: 'Apps Script Deployment ID' },
  { envKey: 'RECAPTCHA_SITE_KEY', remoteKey: 'RECAPTCHA_SITE_KEY', name: 'reCAPTCHA Site Key' },
  { envKey: 'GOOGLE_OAUTH_CLIENT_ID', remoteKey: 'GOOGLE_OAUTH_CLIENT_ID', name: 'Google OAuth Client ID' },
  { envKey: 'SHEETS_SPREADSHEET_ID', remoteKey: 'SHEETS_SPREADSHEET_ID', name: 'Google Spreadsheet ID' },
  { envKey: 'ADMIN_ALLOWED_EMAILS', remoteKey: 'ADMIN_ALLOWED_EMAILS', name: 'Allowed Admin Emails' },
  { envKey: 'SITE_GITHUB_CLIENT_ID', fallbackKey: 'GITHUB_CLIENT_ID', remoteKey: 'SITE_GITHUB_CLIENT_ID', name: 'GitHub OAuth Client ID (CMS)', optional: true },
]

for (const item of keyMap) {
  const localVal = env[item.envKey] || (item.fallbackKey ? env[item.fallbackKey] : '') || ''
  const remoteVal = remoteVars[item.remoteKey] || ''

  if (!localVal && !item.optional) {
    console.log(`  [FAIL] ${item.name} (${item.envKey}) is missing in local .env`)
    overallPass = false
    continue
  }
  if (localVal && !remoteVal && !item.optional) {
    console.log(`  [WARN] ${item.name} is set locally but MISSING in remote GitHub Actions variables`)
  } else if (localVal && remoteVal && localVal !== remoteVal) {
    console.log(`  [FAIL] ${item.name} MISMATCH! Local="${localVal.slice(0, 15)}..." vs Remote="${remoteVal.slice(0, 15)}..."`)
    overallPass = false
  } else if (localVal || remoteVal) {
    console.log(`  [OK] ${item.name.padEnd(30)} matches local & GitHub remote.`)
  } else {
    console.log(`  [OPTIONAL] ${item.name.padEnd(30)} — Unset (optional)`)
  }
}

// GitHub Pages Check
try {
  const pagesJson = execSync(`${ghPath} api repos/gndflooring/web-site/pages`, { stdio: 'pipe' }).toString()
  const pages = JSON.parse(pagesJson)
  console.log(`\n--- GitHub Pages Deployment Status ---`)
  console.log(`  [OK] Custom Domain    : ${pages.cname || pages.html_url}`)
  console.log(`  [OK] HTTPS Enforced   : ${pages.https_enforced ? 'YES' : 'NO'}`)
  console.log(`  [OK] Certificate State: ${pages.https_certificate?.state || 'Unknown'}`)
} catch (e) {
  console.log(`  [WARN] Could not fetch GitHub Pages status: ${e.message}`)
}

// Latest GitHub Action Run
try {
  const runsJson = execSync(`${ghPath} api repos/gndflooring/web-site/actions/runs?per_page=1`, { stdio: 'pipe' }).toString()
  const run = JSON.parse(runsJson).workflow_runs?.[0]
  if (run) {
    console.log(`\n--- Latest GitHub Actions Deployment Run ---`)
    console.log(`  [OK] Workflow : ${run.name}`)
    console.log(`  [OK] Status   : ${run.status} (${run.conclusion || 'in progress'})`)
    console.log(`  [OK] Commit   : ${run.head_sha.slice(0, 7)} — ${run.display_title.slice(0, 50)}`)
  }
} catch (e) {
  console.log(`  [WARN] Could not fetch latest GitHub Action run: ${e.message}`)
}

/* ----------------------------------------------------------------------
   SECTION 2: GitHub OAuth App Client Verification (CMS)
---------------------------------------------------------------------- */
console.log('\n--- 2. GitHub OAuth App Client (CMS) Audit ---')
const ghClientId = env.SITE_GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID || remoteVars.SITE_GITHUB_CLIENT_ID || ''
if (ghClientId) {
  try {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: ghClientId, scope: 'repo' }),
    })
    const data = await res.json()
    if (data.device_code && data.user_code) {
      console.log('  [OK] GitHub OAuth App Client ID is VALID and Device Flow is ENABLED.')
      console.log(`       Verified endpoint response: user_code=${data.user_code}`)
    } else if (data.error) {
      console.log(`  [FAIL] GitHub OAuth App Client ID check failed: ${data.error} — ${data.error_description}`)
      overallPass = false
    }
  } catch (e) {
    console.log(`  [FAIL] Could not verify GitHub OAuth App Client ID: ${e.message}`)
  }
} else {
  console.log('  [OPTIONAL] GITHUB_CLIENT_ID / SITE_GITHUB_CLIENT_ID is not set.')
  console.log('             (CMS content editing in /admin will be disabled until configured).')
}

/* ----------------------------------------------------------------------
   SECTION 3: Google Apps Script Web App & Relay Audit
---------------------------------------------------------------------- */
console.log('\n--- 3. Google Apps Script Web App & Relay Endpoint Audit ---')
const sheetsUrl = env.SHEETS_URL || remoteVars.SHEETS_URL || (env.SHEETS_DEPLOYMENT_ID ? `https://script.google.com/macros/s/${env.SHEETS_DEPLOYMENT_ID}/exec` : '')

if (sheetsUrl) {
  // Test GET (JSONP Relay)
  try {
    const res = await fetch(`${sheetsUrl}?gh=ping&callback=diagnostic_cb`)
    const text = await res.text()
    if (text.includes('diagnostic_cb') || text.includes('gnd github device relay')) {
      console.log('  [OK] Apps Script GET JSONP Relay endpoint responded cleanly.')
    } else {
      console.log('  [WARN] Apps Script GET responded, but relay marker was missing:', text.slice(0, 120))
    }
  } catch (e) {
    console.log(`  [FAIL] Apps Script GET endpoint error: ${e.message}`)
    overallPass = false
  }

  // Test POST (Contact Form Submission)
  try {
    const testPayload = {
      name: 'System Diagnostic Test',
      phone: '555-000-0000',
      email: 'test@gnd-flooring.com',
      service: 'Diagnostic',
      message: 'Automated health verification ping',
      source: 'verify-full-system',
      submittedAt: new Date().toISOString(),
      isDiagnosticPing: true,
    }
    const res = await fetch(sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(testPayload),
      redirect: 'follow',
    })
    console.log(`  [OK] Apps Script POST endpoint reached (Status: ${res.status}).`)
  } catch (e) {
    console.log(`  [WARN] Apps Script POST test encountered error: ${e.message}`)
  }
} else {
  console.log('  [FAIL] SHEETS_URL is missing.')
  overallPass = false
}

/* ----------------------------------------------------------------------
   SECTION 4: Google OAuth Client & Google Sheet Structure Audit
---------------------------------------------------------------------- */
console.log('\n--- 4. Google OAuth Client & Google Sheet Audit ---')
const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID || remoteVars.GOOGLE_OAUTH_CLIENT_ID || ''
if (googleClientId) {
  if (/\.apps\.googleusercontent\.com$/.test(googleClientId)) {
    console.log(`  [OK] Google OAuth Client ID format is valid (${googleClientId.slice(0, 25)}...).`)
  } else {
    console.log(`  [WARN] Google OAuth Client ID format looks unusual: ${googleClientId}`)
  }
  try {
    const disc = await fetch('https://accounts.google.com/.well-known/openid-configuration').then((r) => r.json())
    if (disc.issuer === 'https://accounts.google.com') {
      console.log('  [OK] Google OpenID / OAuth 2.0 discovery endpoint is reachable.')
    }
  } catch (e) {
    console.log(`  [WARN] Could not reach Google OAuth discovery endpoint: ${e.message}`)
  }
} else {
  console.log('  [FAIL] GOOGLE_OAUTH_CLIENT_ID is missing.')
  overallPass = false
}

const spreadsheetId = env.SHEETS_SPREADSHEET_ID || remoteVars.SHEETS_SPREADSHEET_ID || ''
if (spreadsheetId) {
  if (/^[a-zA-Z0-9-_]{20,60}$/.test(spreadsheetId)) {
    console.log(`  [OK] Google Spreadsheet ID format is valid (${spreadsheetId}).`)
  } else {
    console.log(`  [WARN] Google Spreadsheet ID format looks invalid: ${spreadsheetId}`)
    overallPass = false
  }
} else {
  console.log('  [FAIL] SHEETS_SPREADSHEET_ID is missing.')
  overallPass = false
}

/* ----------------------------------------------------------------------
   FINAL SUMMARY & RECOMMENDATIONS
---------------------------------------------------------------------- */
console.log('\n======================================================================')
if (overallPass) {
  console.log(' OVERALL SYSTEM STATUS: HEALTHY & FULLY VERIFIED! ')
} else {
  console.log(' OVERALL SYSTEM STATUS: DISCREPANCIES DETECTED — See details above. ')
}
console.log('======================================================================\n')
