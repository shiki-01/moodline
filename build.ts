import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const alias = { $lib: resolve(__dirname, 'src/lib') }

async function main() {
  // 1. Content script — bundled IIFE, zero external deps
  console.log('Building content script…')
  await build({
    configFile: false,
    resolve: { alias },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      lib: {
        entry: resolve(__dirname, 'src/content/index.ts'),
        name: 'moodline',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  })

  // 2. Popup — Svelte 5 + Master CSS
  console.log('Building popup…')
  await build({
    configFile: false,
    resolve: { alias },
    plugins: [
      svelte(),
      viteStaticCopy({
        targets: [
          { src: 'manifest.json', dest: '.' },
          { src: 'public/icons/*', dest: 'icons' },
          { src: 'popup.html', dest: '.' },
        ],
      }),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: { popup: resolve(__dirname, 'src/popup/main.ts') },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-chunk.js',
          assetFileNames: '[name].[ext]',
        },
      },
    },
  })

  console.log('Done ✓')
}

main().catch(e => { console.error(e); process.exit(1) })
