/**
 * @fileOverview Vite configuration, used for both the library and the docs site.
 * The docs site can be used to test and develop the library.
 *
 * - `npm run dev` or `npm run start`: start the preview of the docs site.
 * - `npm run build`: build the library.
 * - `npm run build-docs`: build the docs site.
 */

import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Settings for building the library.
 *
 * React and Vue files are kept because they have been part of the original code,
 * in case we want to merge these changes back upstream.
 */
const libraryBuild = {
  lib: {
    entry: {
      'scrolly-video': resolve(__dirname, 'src/ScrollyVideo.js'),
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

/**
 * No special settings are needed for the docs site.
 */
const docsBuild = {};

const docsBuildPlugins = [svelte(), vue()];
const libraryBuildPlugins = [viteWrapCodeInIIFE()];

/**
 * @see https://vite.dev/config/
 */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins:
    mode === 'library'
      ? libraryBuildPlugins.concat(docsBuildPlugins)
      : docsBuildPlugins,
  build: mode === 'library' ? libraryBuild : docsBuild,
}));

/**
 * Solves the issue of vite not wrapping all the code in an IIFE, which can lead to bundles overriding each other.
 * @see https://github.com/vitejs/vite/issues/16443
 * @see https://github.com/vitejs/vite/issues/17608#issue-2388013526
 */
function viteWrapCodeInIIFE(options = {}) {
  return {
    name: 'vite-wrap-code-in-iife',
    apply: 'build',
    enforce: 'post',
    generateBundle(outputOptions, bundle) {
      for (const [fileName, chunkOrAsset] of Object.entries(bundle)) {
        if (
          chunkOrAsset.type === 'chunk' &&
          options.files &&
          options.files.includes(fileName)
        ) {
          chunkOrAsset.code = `(function () {${chunkOrAsset.code}})();`;
        }
      }
    },
  };
}
