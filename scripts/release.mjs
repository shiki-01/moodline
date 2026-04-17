import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const allowDirty = args.has('--allow-dirty')

function run(command, options = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${command}`)
    return ''
  }
  return execSync(command, { stdio: options.silent ? 'pipe' : 'inherit', encoding: 'utf-8' })
}

function runSilent(command) {
  return execSync(command, { stdio: 'pipe', encoding: 'utf-8' }).trim()
}

function fail(message) {
  console.error(`\n[release] ${message}`)
  process.exit(1)
}

const version = pkg.version
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json version is invalid: ${String(version)}`)
}

const tag = `v${version}`

try {
  runSilent('git rev-parse --is-inside-work-tree')
} catch {
  fail('not a git repository')
}

if (!allowDirty) {
  const dirty = runSilent('git status --porcelain')
  if (dirty.length > 0) {
    fail('working tree is dirty. Commit or stash changes first (or use --allow-dirty).')
  }
}

try {
  runSilent(`git rev-parse -q --verify refs/tags/${tag}`)
  fail(`tag ${tag} already exists locally`)
} catch {
  // Expected when tag doesn't exist.
}

try {
  const remoteTag = runSilent(`git ls-remote --tags origin refs/tags/${tag}`)
  if (remoteTag) fail(`tag ${tag} already exists on origin`)
} catch (error) {
  if (!String(error).includes('already exists')) {
    fail('failed to query origin tags. Check remote/auth configuration.')
  }
}

console.log(`[release] creating tag ${tag}`)
run(`git tag -a ${tag} -m "Release ${tag}"`)

console.log(`[release] pushing tag ${tag} to origin`)
run(`git push origin ${tag}`)

console.log(`\n[release] done: pushed ${tag}`)
console.log('[release] GitHub Actions will build and publish the release.')
