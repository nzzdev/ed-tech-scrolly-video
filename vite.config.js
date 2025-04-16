import {dirname, resolve} from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: {
        'svelte': resolve(__dirname, 'src/ScrollyVideo.svelte'),
      },
      name: 'ScrollyVideo',
    }

  }
})