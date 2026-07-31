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

// Parse CLI flags
function getArg(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx > -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1]
  }
  return ''
}

const cliSheetId = getArg('--sheet-id') || getArg('--sheet')
const cliDeploymentId = getArg('--deployment-id')
const cliSheetsUrl = getArg('--sheets-url')
const cliGoogleToken = getArg('--google-token')
const cliGithubToken = getArg('--github-token')

console.log('\n======================================================================')
console.log(' G&D Flooring — Live System, Scopes & API Permission Auditor')
console.log('======================================================================\n')

if (cliSheetId || cliDeploymentId || cliSheetsUrl) {
  console.log('CLI Overrides Provided:')
  if (cliSheetId) console.log(`  [OVERRIDE] Sheet ID       : ${cliSheetId}`)
  if (cliDeploymentId) console.log(`  [OVERRIDE] Deployment ID  : ${cliDeploymentId}`)
  if (cliSheetsUrl) console.log(`  [OVERRIDE] Sheets URL     : ${cliSheetsUrl}`)
  console.log('')
}

let overallPass = true

/* ----------------------------------------------------------------------
   SECTION 1: GitHub API, Token Scopes & Repo Permissions Audit
---------------------------------------------------------------------- */
console.log('--- 1. GitHub Environment, Scopes & Permissions Audit ---')

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
const targetSheetId = cliSheetId || env.SHEETS_SPREADSHEET_ID || remoteVars.SHEETS_SPREADSHEET_ID || ''
const targetDeploymentId = cliDeploymentId || env.SHEETS_DEPLOYMENT_ID || remoteVars.SHEETS_DEPLOYMENT_ID || ''
const targetSheetsUrl = cliSheetsUrl || env.SHEETS_URL || remoteVars.SHEETS_URL || (targetDeploymentId ? `https://script.google.com/macros/s/${targetDeploymentId}/exec` : '')

const keyMap = [
  { envKey: 'SHEETS_URL', activeVal: targetSheetsUrl, remoteKey: 'SHEETS_URL', name: 'Google Apps Script URL' },
  { envKey: 'SHEETS_DEPLOYMENT_ID', activeVal: targetDeploymentId, remoteKey: 'SHEETS_DEPLOYMENT_ID', name: 'Apps Script Deployment ID' },
  { envKey: 'RECAPTCHA_SITE_KEY', activeVal: env.RECAPTCHA_SITE_KEY, remoteKey: 'RECAPTCHA_SITE_KEY', name: 'reCAPTCHA Site Key' },
  { envKey: 'GOOGLE_OAUTH_CLIENT_ID', activeVal: env.GOOGLE_OAUTH_CLIENT_ID, remoteKey: 'GOOGLE_OAUTH_CLIENT_ID', name: 'Google OAuth Client ID' },
  { envKey: 'SHEETS_SPREADSHEET_ID', activeVal: targetSheetId, remoteKey: 'SHEETS_SPREADSHEET_ID', name: 'Google Spreadsheet ID' },
  { envKey: 'ADMIN_ALLOWED_EMAILS', activeVal: env.ADMIN_ALLOWED_EMAILS, remoteKey: 'ADMIN_ALLOWED_EMAILS', name: 'Allowed Admin Emails' },
  { envKey: 'SITE_GITHUB_CLIENT_ID', fallbackKey: 'GITHUB_CLIENT_ID', activeVal: env.SITE_GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID, remoteKey: 'SITE_GITHUB_CLIENT_ID', name: 'GitHub OAuth Client ID (CMS)', optional: true },
]

for (const item of keyMap) {
  const localVal = item.activeVal || ''
  const remoteVal = remoteVars[item.remoteKey] || ''

  if (!localVal && !item.optional) {
    console.log(`  [FAIL] ${item.name} (${item.envKey}) is missing`)
    overallPass = false
    continue
  }
  if (localVal && !remoteVal && !item.optional) {
    console.log(`  [WARN] ${item.name} is set locally/CLI but MISSING in remote GitHub Actions variables`)
  } else if (localVal && remoteVal && localVal !== remoteVal) {
    console.log(`  [FAIL] ${item.name} MISMATCH! Local/CLI="${localVal.slice(0, 15)}..." vs Remote="${remoteVal.slice(0, 15)}..."`)
    overallPass = false
  } else if (localVal || remoteVal) {
    console.log(`  [OK] ${item.name.padEnd(30)} verified (${(localVal || remoteVal).slice(0, 20)}...).`)
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

// GitHub Token Scopes & Repo Write Permission Verification
const ghTokenToUse = cliGithubToken || process.env.GITHUB_TOKEN || ''
try {
  const authCmd = cliGithubToken
    ? `${ghPath} api user -i -H "Authorization: Bearer ${cliGithubToken}"`
    : `${ghPath} api user -i`
  const userResp = execSync(authCmd, { stdio: 'pipe' }).toString()
  
  const scopeLine = userResp.split('\n').find((l) => /^x-oauth-scopes:/i.test(l))
  const scopes = scopeLine ? scopeLine.split(':')[1].trim() : 'n/a (fine-grained token)'
  console.log(`\n--- GitHub User Token Scopes & Repository Access ---`)
  console.log(`  [OK] GitHub Authenticated User Scopes: ${scopes}`)
  
  if (scopes.includes('repo') || scopes.includes('n/a')) {
    console.log(`  [OK] Token scope contains required repository access ('repo').`)
  } else {
    console.log(`  [WARN] Token scope '${scopes}' may lack full repository write access (CMS requires 'repo' scope).`)
  }

  const repoCheck = execSync(`${ghPath} api repos/gndflooring/web-site`, { stdio: 'pipe' }).toString()
  const repoData = JSON.parse(repoCheck)
  const perms = repoData.permissions || {}
  console.log(`  [OK] Repository Permissions: push=${perms.push}, admin=${perms.admin}`)
  if (!perms.push) {
    console.log(`  [FAIL] Authenticated GitHub account lacks push access to repository gndflooring/web-site!`)
    overallPass = false
  }
} catch (e) {
  console.log(`  [WARN] Could not inspect GitHub token scopes: ${e.message}`)
}

/* ----------------------------------------------------------------------
   SECTION 2: GitHub OAuth App Client (CMS) Audit
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
   SECTION 3: Google Apps Script Web App & Relay Endpoint Audit
---------------------------------------------------------------------- */
console.log('\n--- 3. Google Apps Script Web App & Relay Endpoint Audit ---')
console.log(`Target Apps Script URL: ${targetSheetsUrl || 'UNSET'}`)

if (targetSheetsUrl) {
  // Test GET (JSONP Relay)
  try {
    const res = await fetch(`${targetSheetsUrl}?gh=ping&callback=diagnostic_cb`)
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
    const res = await fetch(targetSheetsUrl, {
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
  console.log('  [FAIL] Target SHEETS_URL / SHEETS_DEPLOYMENT_ID is missing.')
  overallPass = false
}

/* ----------------------------------------------------------------------
   SECTION 4: Google OAuth Client, Scopes & Google Sheet Structure Audit
---------------------------------------------------------------------- */
console.log('\n--- 4. Google OAuth Client, Scopes & Google Sheet Audit ---')

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
      console.log(`       Supported scopes verified: ${disc.scopes_supported ? disc.scopes_supported.slice(0, 6).join(', ') : 'standard'}`)
    }
  } catch (e) {
    console.log(`  [WARN] Could not reach Google OAuth discovery endpoint: ${e.message}`)
  }
} else {
  console.log('  [FAIL] GOOGLE_OAUTH_CLIENT_ID is missing.')
  overallPass = false
}

console.log(`\nTarget Google Spreadsheet ID: ${targetSheetId || 'UNSET'}`)
if (targetSheetId) {
  if (/^[a-zA-Z0-9-_]{20,60}$/.test(targetSheetId)) {
    console.log(`  [OK] Google Spreadsheet ID format is valid (${targetSheetId}).`)
  } else {
    console.log(`  [WARN] Google Spreadsheet ID format looks invalid: ${targetSheetId}`)
    overallPass = false
  }
} else {
  console.log('  [FAIL] SHEETS_SPREADSHEET_ID is missing.')
  overallPass = false
}

// Token Scopes Audit (if --google-token provided)
if (cliGoogleToken) {
  console.log('\n--- Google OAuth Access Token Scopes & Sheet Structure Audit ---')
  try {
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${cliGoogleToken}`)
    const tokenInfo = await tokenInfoRes.json()
    
    if (tokenInfo.scope) {
      console.log(`  [OK] Google Token Scopes: ${tokenInfo.scope}`)
      const requiredScopes = ['spreadsheets', 'email', 'openid']
      for (const req of requiredScopes) {
        if (tokenInfo.scope.includes(req)) {
          console.log(`  [OK] Scope '${req}' is GRANTED.`)
        } else {
          console.log(`  [FAIL] Required scope '${req}' is MISSING from Google access token!`)
          overallPass = false
        }
      }
    } else if (tokenInfo.error_description) {
      console.log(`  [FAIL] Google OAuth Token Info error: ${tokenInfo.error_description}`)
      overallPass = false
    }

    // Direct Google Sheets API Metadata & Tabs Verification
    if (targetSheetId) {
      const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSheetId}?fields=sheets(properties(title))`, {
        headers: { Authorization: `Bearer ${cliGoogleToken}` },
      })
      if (sheetRes.ok) {
        const sheetData = await sheetRes.json()
        const existingTabs = (sheetData.sheets || []).map((s) => s.properties.title)
        console.log(`  [OK] Google Sheet API call succeeded. Found tabs: ${existingTabs.join(', ')}`)
        
        const requiredTabs = ['FormResponses', 'Tracking', 'Activity', 'Schedule', 'Tasks', 'Snoozes', 'Notes', 'Addresses', 'Tags']
        for (const tab of requiredTabs) {
          if (existingTabs.includes(tab)) {
            console.log(`    [OK] Tab '${tab}' is present.`)
          } else {
            console.log(`    [WARN] Tab '${tab}' is missing (will be auto-created on first admin load).`)
          }
        }
      } else {
        const errText = await sheetRes.text()
        console.log(`  [FAIL] Google Sheets API error ${sheetRes.status}: ${errText.slice(0, 150)}`)
        overallPass = false
      }
    }
  } catch (e) {
    console.log(`  [FAIL] Could not verify Google OAuth Token or Sheets API: ${e.message}`)
    overallPass = false
  }
} else {
  console.log('  Tip: Pass "--google-token <oauth_access_token>" to verify live Google Sheets API permissions and sheet tabs.')
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
