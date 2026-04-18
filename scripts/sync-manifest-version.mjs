import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const packageJsonPath = resolve(root, 'package.json')
const manifestPath = resolve(root, 'manifest.json')

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const manifestText = readFileSync(manifestPath, 'utf-8')
const manifest = JSON.parse(manifestText)

if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
  console.error('[sync-manifest-version] package.json version is invalid')
  process.exit(1)
}

if (manifest.version !== pkg.version) {
  const updated = manifestText.replace(
    /("version"\s*:\s*")([^"]+)(")/,
    `$1${pkg.version}$3`
  )
  writeFileSync(manifestPath, updated, 'utf-8')
  console.log(`[sync-manifest-version] manifest version updated to ${pkg.version}`)
} else {
  console.log(`[sync-manifest-version] manifest version already ${pkg.version}`)
}
