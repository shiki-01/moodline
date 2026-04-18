import { createWriteStream, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import archiver from 'archiver'

const root = process.cwd()
const outName = process.argv[2] ?? 'source.zip'
const outPath = resolve(root, outName)

mkdirSync(dirname(outPath), { recursive: true })

const output = createWriteStream(outPath)
const archive = archiver('zip', { zlib: { level: 9 } })

output.on('close', () => {
  console.log(`[package:source] created ${outName} (${archive.pointer()} bytes)`)
})

archive.on('warning', err => {
  if (err.code === 'ENOENT') {
    console.warn(`[package:source] warning: ${err.message}`)
    return
  }
  throw err
})

archive.on('error', err => {
  throw err
})

archive.pipe(output)

archive.glob('**/*', {
  cwd: root,
  dot: true,
  ignore: [
    '.git/**',
    'node_modules/**',
    'dist/**',
    'firedox-dist/**',
    '.claude/**',
    '**/*.zip',
  ],
})

await archive.finalize()
