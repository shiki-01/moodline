import { createWriteStream } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
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
