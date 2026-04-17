import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const alias = { $lib: resolve(__dirname, 'src/lib') }

// Content script build — single IIFE file, no external chunks
export const contentConfig = defineConfig({
  plugins: [],
  resolve: { alias },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
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

// Popup build — Svelte + full asset pipeline
export const popupConfig = defineConfig({
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
  resolve: { alias },
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

export default popupConfig
