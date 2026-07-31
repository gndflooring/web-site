import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const claspJsonPath = path.resolve(process.cwd(), '.clasp.json')
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

console.log('\n======================================================================')
console.log(' G&D Flooring — Google Apps Script Automated CLI Deployment Helper')
console.log('======================================================================\n')

// 1. Ensure .clasp.json exists
let scriptId = env.SHEETS_SCRIPT_ID || ''
if (fs.existsSync(claspJsonPath)) {
  try {
    const c = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'))
    if (c.scriptId && c.scriptId !== 'PASTE_YOUR_APPS_SCRIPT_ID_HERE') {
      scriptId = c.scriptId
    }
  } catch {}
}

if (!scriptId || scriptId.startsWith('AKfyc')) {
  console.log('  [ATTENTION] SHEETS_SCRIPT_ID is missing or set to a Deployment ID instead of a Script ID.')
  console.log('  To resolve this:')
  console.log('  1. Open your Apps Script Editor (Extensions -> Apps Script from your Google Sheet).')
  console.log('  2. Click ⚙️ Project Settings in the left sidebar.')
  console.log('  3. Copy the "Script ID" (looks like 1a2b3c4d5e6f...).')
  console.log('  4. Add SHEETS_SCRIPT_ID=<your_script_id> to your .env file.\n')
  process.exit(1)
}

// Generate .clasp.json if not present
const claspConfig = { scriptId, rootDir: 'app-script' }
fs.writeFileSync(claspJsonPath, JSON.stringify(claspConfig, null, 2) + '\n')
console.log(`  [OK] Using Script ID: ${scriptId}`)

// Generate app-script/env-config.gs with current environment's Spreadsheet ID
const sheetId = env.SHEETS_SPREADSHEET_ID || process.env.SHEETS_SPREADSHEET_ID || ''
if (sheetId) {
  const envConfigPath = path.resolve(process.cwd(), 'app-script', 'env-config.gs')
  const envContent = `// Auto-generated build artifact from .env during deployment\nvar SPREADSHEET_ID_INJECTED = ${JSON.stringify(sheetId)};\n`
  fs.writeFileSync(envConfigPath, envContent)
  console.log(`  [OK] Injected SHEETS_SPREADSHEET_ID (${sheetId}) into app-script/env-config.gs`)
}

// 2. Check login status
try {
  console.log('\n1. Checking Google Clasp Authentication...')
  execSync('npx @google/clasp status', { stdio: 'pipe' })
  console.log('  [OK] Clasp is authenticated with Google.')
} catch (e) {
  console.log('  [NOTICE] Clasp is not logged in.')
  console.log('  Running "npx @google/clasp login" to authenticate with your Google account...\n')
  try {
    execSync('npx @google/clasp login', { stdio: 'inherit' })
  } catch (loginErr) {
    console.log('  [FAIL] Login failed:', loginErr.message)
    process.exit(1)
  }
}

// 3. Push code to Apps Script
console.log('\n2. Pushing code to Google Apps Script...')
try {
  execSync('npx @google/clasp push --force', { stdio: 'inherit' })
  console.log('  [OK] Code successfully pushed to Google Apps Script.')
} catch (e) {
  console.log('  [FAIL] Clasp push failed:', e.message)
  process.exit(1)
}

// 4. Deploy web app
console.log('\n3. Deploying Web App Version...')
const depId = env.SHEETS_DEPLOYMENT_ID || ''
try {
  if (depId) {
    execSync(`npx @google/clasp deploy -i "${depId}" -d "CLI deployment ${new Date().toISOString()}"`, { stdio: 'inherit' })
  } else {
    execSync(`npx @google/clasp deploy -d "CLI deployment ${new Date().toISOString()}"`, { stdio: 'inherit' })
  }
  console.log('  [OK] Deployment updated successfully.')
} catch (e) {
  console.log('  [WARN] Clasp deploy warning:', e.message)
}

console.log('\n======================================================================')
console.log(' APPS SCRIPT DEPLOYMENT COMPLETE! ')
console.log('======================================================================\n')
