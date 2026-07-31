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

console.log('\n==================================================')
console.log(' G&D Flooring — Setup & Health Audit Script')
console.log('==================================================\n')

let pass = true

// 1. Audit .env variables
console.log('1. Checking .env Configuration:')
const checks = [
  { key: 'SHEETS_DEPLOYMENT_ID', desc: 'Google Apps Script Deployment ID', required: true },
  { key: 'SHEETS_URL', desc: 'Google Apps Script Exec URL', required: true },
  { key: 'RECAPTCHA_SITE_KEY', desc: 'reCAPTCHA v3 Site Key', required: true },
  { key: 'GOOGLE_OAUTH_CLIENT_ID', desc: 'Google OAuth Client ID (for Admin Login)', required: true },
  { key: 'SHEETS_SPREADSHEET_ID', desc: 'Google Sheet ID (for Leads/Tracking)', required: true },
  { key: 'ADMIN_ALLOWED_EMAILS', desc: 'Allowed Admin Email Addresses', required: true },
  { key: 'SITE_GITHUB_CLIENT_ID', fallback: 'GITHUB_CLIENT_ID', desc: 'GitHub OAuth App Client ID (for Site CMS)', required: false },
  { key: 'SITE_GITHUB_REPO', fallback: 'GITHUB_REPO', desc: 'GitHub Repository (owner/repo)', required: true },
]

for (const c of checks) {
  const val = env[c.key] || env[c.fallback] || ''
  if (val) {
    console.log(`  [OK] ${c.key.padEnd(24)} = ${val.slice(0, 20)}${val.length > 20 ? '...' : ''}`)
  } else if (c.required) {
    console.log(`  [MISSING] ${c.key.padEnd(20)} (${c.desc})`)
    pass = false
  } else {
    console.log(`  [OPTIONAL] ${c.key.padEnd(19)} (${c.desc}) — Unset`)
  }
}

// 2. Check Apps Script endpoint response
console.log('\n2. Testing Google Apps Script Endpoint (SHEETS_URL):')
const sheetsUrl = env.SHEETS_URL || (env.SHEETS_DEPLOYMENT_ID ? `https://script.google.com/macros/s/${env.SHEETS_DEPLOYMENT_ID}/exec` : '')
if (sheetsUrl) {
  try {
    const res = await fetch(`${sheetsUrl}?gh=ping&callback=test`)
    const text = await res.text()
    if (text.includes('gnd github device relay') || text.includes('test(')) {
      console.log('  [OK] Google Apps Script Web App endpoint responded successfully (relay active).')
    } else if (text.includes('ServiceLogin') || text.includes('accounts.google.com') || text.includes('<!DOCTYPE html>')) {
      console.log('  [FAIL] Google Apps Script endpoint redirected to Google Login!')
      console.log('         -> FIX: Open Google Apps Script -> Deploy -> Manage Deployments -> Set "Who has access" to "Anyone".')
      pass = false
    } else {
      console.log('  [WARN] Endpoint reached, but response was unexpected:', text.slice(0, 100))
    }
  } catch (err) {
    console.log('  [FAIL] Could not reach SHEETS_URL:', err.message)
    pass = false
  }
} else {
  console.log('  [FAIL] SHEETS_URL / SHEETS_DEPLOYMENT_ID not set.')
  pass = false
}

// 3. Test GitHub CLI & option to sync secrets to GitHub Actions
console.log('\n3. GitHub Actions Environment Variables Sync:')
try {
  const ghStatus = execSync('/home/mrwho/bin/gh auth status', { stdio: 'pipe' }).toString()
  console.log('  [OK] GitHub CLI is authenticated.')
  
  if (process.argv.includes('--sync-gh')) {
    console.log('  Syncing variables to GitHub Actions repository variables...')
    const varsToSync = [
      'SHEETS_URL',
      'SHEETS_DEPLOYMENT_ID',
      'RECAPTCHA_SITE_KEY',
      'GOOGLE_OAUTH_CLIENT_ID',
      'SHEETS_SPREADSHEET_ID',
      'ADMIN_ALLOWED_EMAILS',
      'SITE_GITHUB_CLIENT_ID',
      'SITE_GITHUB_REPO'
    ]
    for (const v of varsToSync) {
      const val = env[v] || (v === 'SITE_GITHUB_CLIENT_ID' ? env.GITHUB_CLIENT_ID : v === 'SITE_GITHUB_REPO' ? env.GITHUB_REPO : '')
      if (val) {
        try {
          execSync(`/home/mrwho/bin/gh variable set ${v} --body "${val}"`, { stdio: 'pipe' })
          console.log(`  Synced ${v} to GitHub.`)
        } catch (e) {
          console.log(`  Could not sync ${v} to GitHub: ${e.message}`)
        }
      }
    }
  } else {
    console.log('  Tip: Run "node scripts/setup-check.js --sync-gh" to sync these variables to GitHub Repository Variables.')
  }
} catch {
  console.log('  [NOTICE] gh CLI not authenticated locally. Run "gh auth login" if you want to sync env vars automatically.')
}

// 4. Test Production Build
console.log('\n4. Verifying Local Build:')
try {
  execSync('npm run build', { stdio: 'pipe' })
  console.log('  [OK] Vite build succeeded cleanly.')
} catch (err) {
  console.log('  [FAIL] Build failed:', err.message)
  pass = false
}

console.log('\n==================================================')
if (pass) {
  console.log(' SYSTEM STATUS: READY! All core checks passed.')
} else {
  console.log(' SYSTEM STATUS: ATTENTION NEEDED — See missing items above.')
}
console.log('==================================================\n')
