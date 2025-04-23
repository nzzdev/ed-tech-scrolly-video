import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const libraryBuild = {
  lib: {
    entry: {
      "scrolly-video": resolve(__dirname, 'src/ScrollyVideo.js'),
      svelte: resolve(__dirname, 'src/ScrollyVideo.svelte'),
      react: resolve(__dirname, 'src/ScrollyVideo.jsx'),
      vue: resolve(__dirname, 'src/ScrollyVideo.vue'),
    },
    name: 'ScrollyVideo',
  },
  rollupOptions: {
    external: ['svelte', 'vue', 'mp4boxjs', 'react', 'ua-parser-js'],
  },
};

const docsBuild = {};

const docsBuildPlugins = [svelte(), vue()]
const libraryBuildPlugins = [viteWrapCodeInIIFE()]

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'library' ? libraryBuildPlugins.concat(docsBuildPlugins) : docsBuildPlugins,
  build: mode === 'library' ? libraryBuild : docsBuild,
}));


function viteWrapCodeInIIFE(options = {}) {
  return {
    name: 'vite-wrap-code-in-iife',
    apply: 'build',
    enforce: 'post',
    generateBundle(outputOptions, bundle) {
      for (const [fileName, chunkOrAsset] of Object.entries(bundle)) {
        if (chunkOrAsset.type === 'chunk' && options.files && options.files.includes(fileName)) {
          chunkOrAsset.code = `(function () {${chunkOrAsset.code}})();`;
        }
      }
    },
  };
}