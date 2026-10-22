import { defineConfig } from 'tsdown'

// Two halves, two runtimes:
// - `lib/index.js` is the host module the profile loader imports (a no-op
//   Cordis plugin that only makes the package mountable).
// - `lib/client.js` is the browser bundle in the
//   `window.__ModuleLoader__.load({ id, factory })` format the Web shell
//   expects. The wrapper is hand-supplied here; platform modules would stay
//   external (`external`), but this plugin imports none.
const ID = '@lim324/dsh-layout-persist'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    outputOptions: { entryFileNames: 'index.js' },
  },
  {
    entry: ['src/client/index.ts'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
