import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const envPath = path.resolve(process.cwd(), '.env')
const ghPath = fs.existsSync('/home/mrwho/bin/gh') ? '/home/mrwho/bin/gh' : 'gh'

console.log('\n======================================================================')
console.log(' G&D Flooring — Sync Environment Variables from GitHub to Local .env')
console.log('======================================================================\n')

try {
  console.log('1. Querying GitHub Repository Variables via GitHub CLI...')
  const repoRes = execSync(`${ghPath} api repos/gndflooring/web-site/actions/variables`, { stdio: 'pipe' }).toString()
  const parsed = JSON.parse(repoRes)
  const remoteVars = parsed.variables || []

  if (remoteVars.length === 0) {
    console.log('  [WARN] No GitHub Actions repository variables found.')
    process.exit(0)
  }

  console.log(`  Found ${remoteVars.length} repository variables on GitHub.\n`)

  // Read current .env content or initialize
  let envLines = []
  if (fs.existsSync(envPath)) {
    envLines = fs.readFileSync(envPath, 'utf8').split('\n')
  }

  const envMap = new Map()
  const keyOrder = []

  for (const line of envLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx > -1) {
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim()
      envMap.set(key, val)
      keyOrder.push(key)
    }
  }

  let updatedCount = 0
  let addedCount = 0

  for (const v of remoteVars) {
    const key = v.name
    const val = v.value
    if (envMap.has(key)) {
      if (envMap.get(key) !== val) {
        console.log(`  [UPDATE] ${key.padEnd(25)} : ${envMap.get(key)} -> ${val}`)
        envMap.set(key, val)
        updatedCount++
      } else {
        console.log(`  [OK] ${key.padEnd(29)} : Matches remote (${val.slice(0, 15)}...)`)
      }
    } else {
      console.log(`  [ADD] ${key.padEnd(28)} : ${val}`)
      envMap.set(key, val)
      keyOrder.push(key)
      addedCount++
    }
  }

  // Reconstruct .env file preserving comments and structure
  let updatedEnvContent = ''
  if (fs.existsSync(envPath)) {
    const originalContent = fs.readFileSync(envPath, 'utf8')
    const lines = originalContent.split('\n')
    const processedKeys = new Set()

    const newLines = lines.map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line
      const idx = trimmed.indexOf('=')
      if (idx > -1) {
        const key = trimmed.slice(0, idx).trim()
        processedKeys.add(key)
        if (envMap.has(key)) {
          return `${key}=${envMap.get(key)}`
        }
      }
      return line
    })

    // Append any newly added keys at the bottom
    for (const key of keyOrder) {
      if (!processedKeys.has(key)) {
        newLines.push(`${key}=${envMap.get(key)}`)
      }
    }
    updatedEnvContent = newLines.join('\n')
  } else {
    updatedEnvContent = Array.from(envMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  }

  fs.writeFileSync(envPath, updatedEnvContent)

  console.log('\n======================================================================')
  console.log(` SYNC COMPLETE! Updated: ${updatedCount}, Added: ${addedCount} variable(s) to .env.`)
  console.log('======================================================================\n')
} catch (e) {
  console.log(`\n  [FAIL] Failed to sync variables from GitHub: ${e.message}`)
  console.log('  Ensure GitHub CLI is authenticated ("gh auth login") and has access to the repo.\n')
  process.exit(1)
}
