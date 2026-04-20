import { createWriteStream } from 'node:fs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import archiver from 'archiver'

const root = process.cwd()
const distDir = resolve(root, 'dist')
const outName = process.argv[2] ?? 'dist.zip'
const outPath = resolve(root, outName)

mkdirSync(dirname(outPath), { recursive: true })

if (!existsSync(distDir)) {
  console.error('[package:zip] dist directory does not exist. Run "npm run build" first.')
  process.exit(1)
}

if (outName.endsWith('.xpi')) {
  const distManifestPath = resolve(distDir, 'manifest.json')
  if (!existsSync(distManifestPath)) {
    console.error('[package:zip] dist/manifest.json does not exist. Run "npm run build" first.')
    process.exit(1)
  }

  const manifest = JSON.parse(readFileSync(distManifestPath, 'utf-8'))
  const geckoId = manifest?.browser_specific_settings?.gecko?.id
  if (typeof geckoId !== 'string' || geckoId.length === 0) {
    console.error('[package:zip] Firefox XPI requires browser_specific_settings.gecko.id in dist/manifest.json.')
    process.exit(1)
  }
}

const output = createWriteStream(outPath)
const archive = archiver('zip', { zlib: { level: 9 } })

output.on('close', () => {
  console.log(`[package:zip] created ${outName} (${archive.pointer()} bytes)`)
})

archive.on('warning', err => {
  if (err.code === 'ENOENT') {
    console.warn(`[package:zip] warning: ${err.message}`)
    return
  }
  throw err
})

archive.on('error', err => {
  throw err
})

archive.pipe(output)

// false strips the top-level dist directory so manifest.json is at ZIP root.
archive.directory(distDir, false)

await archive.finalize()
