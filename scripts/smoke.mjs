/**
 * Offline smoke test for the built browser half.
 *
 * Boots `lib/client.js` in a `node:vm` context that mimics the two browser
 * seams the plugin touches — `window.__ModuleLoader__` and `window.localStorage`
 * — plus the slot ledger, and asserts the four behaviors that make a restart
 * keep the user's widths:
 *
 *  1. a fresh profile leaves the layout store's defaults alone;
 *  2. saved widths are written into the store on attach;
 *  3. a later width change is mirrored back to localStorage (debounced);
 *  4. a closed sidebar (`0`) never overwrites the remembered width.
 *
 * Run with `pnpm smoke` after `pnpm build`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const BUNDLE = new URL('../lib/client.js', import.meta.url)
const STORAGE_KEY = 'dsh.layout.widths.v1'
const SIDEBAR_DEFAULT = 280
const SIDEBAR_MIN = 264
const SIDEBAR_MAX = 420
const RIGHTBAR_MIN = 300
const RIGHTBAR_DEFAULT_RATIO = 0.45
const VIEWPORT = 1680

const source = readFileSync(BUNDLE, 'utf8')

/**
 * Build one isolated browser-ish context plus the fake layout store the plugin
 * is supposed to find in the `root` slot ledger.
 * @param {{ stored?: Record<string, string>, registerStore?: boolean }} options - initial storage and whether the store is already registered.
 */
function boot({ stored = {}, registerStore = false } = {}) {
  const data = new Map(Object.entries(stored))
  let registration
  const ledgerListeners = new Set()

  const localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  }

  // Mirrors the engine handle the layout plugin pins to its live singleton.
  const layoutInfo = { sidebar: SIDEBAR_DEFAULT, viewportWidth: VIEWPORT, rightbar: null }
  let state = { panelInfo: { activePanelId: null }, layoutInfo }
  const listeners = new Set()
  const notify = () => { for (const listener of [...listeners]) listener() }
  const instance = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    actions: {
      setSidebar(px) {
        state = { ...state, layoutInfo: { ...state.layoutInfo, sidebar: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px))) } }
        notify()
      },
      setRightbar(px) {
        state = { ...state, layoutInfo: { ...state.layoutInfo, rightbar: Math.round(px) } }
        notify()
      },
      toggleSidebar() {
        // The real store's setSidebar clamps to [264, 420]; 0 only comes from this toggle.
        state = { ...state, layoutInfo: { ...state.layoutInfo, sidebar: state.layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : 0 } }
        notify()
      },
      openRightbar() {
        state = { ...state, layoutInfo: { ...state.layoutInfo, rightbar: state.layoutInfo.rightbar ?? Math.round(VIEWPORT * RIGHTBAR_DEFAULT_RATIO) } }
        notify()
      },
    },
  }
  const handle = {
    spec: { init: () => ({ panelInfo: { activePanelId: null }, layoutInfo: { sidebar: SIDEBAR_DEFAULT, viewportWidth: VIEWPORT, rightbar: null } }) },
    create: () => instance,
  }
  const entry = { store: handle }
  if (registerStore) registration = entry

  const registry = {
    entries: (key) => (key === 'root' && registration !== undefined ? [registration] : []),
    subscribe: (key, listener) => {
      if (key === 'root') ledgerListeners.add(listener)
      return () => ledgerListeners.delete(listener)
    },
  }

  const window = {
    localStorage,
    __ModuleLoader__: { load: (loaded) => void (window.__loaded = loaded) },
  }
  const context = createContext({ window, setTimeout, clearTimeout, console })

  runInContext(source, context)
  assert.ok(window.__loaded, 'bundle must register itself through window.__ModuleLoader__.load')
  assert.equal(window.__loaded.id, '@lim324/dsh-layout-persist', 'bundle id must equal the package name')
  const plugin = window.__loaded.factory(() => {
    throw new Error('the layout-persist client bundle must not require any external module')
  })

  let dispose
  const ctx = {
    slots: registry,
    effect(body) {
      dispose = body()
    },
  }
  plugin.apply(ctx)

  return {
    plugin,
    storage: data,
    state: () => state,
    actions: instance.actions,
    register() {
      registration = entry
      for (const listener of [...ledgerListeners]) listener()
    },
    dispose: () => dispose?.(),
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 1. Fresh profile: no stored widths, no ledger entry yet, nothing to restore.
{
  const app = boot()
  assert.equal(app.state().layoutInfo.sidebar, SIDEBAR_DEFAULT)
  assert.equal(app.state().layoutInfo.rightbar, null)
  assert.equal(app.storage.has(STORAGE_KEY), false)
  app.dispose()
}

// 2. Saved widths are restored when the store appears after plugin apply.
{
  const app = boot({ stored: { [STORAGE_KEY]: JSON.stringify({ sidebar: 320, rightbar: 560 }) } })
  assert.equal(app.state().layoutInfo.sidebar, SIDEBAR_DEFAULT, 'restore waits for the store registration')
  app.register()
  assert.equal(app.state().layoutInfo.sidebar, 320)
  assert.equal(app.state().layoutInfo.rightbar, 560)

  // 3. A later drag is mirrored back (debounced).
  app.actions.setSidebar(360)
  assert.equal(app.state().layoutInfo.sidebar, 360)
  await sleep(400)
  assert.deepEqual(JSON.parse(app.storage.get(STORAGE_KEY)), { sidebar: 360, rightbar: 560 })

  // 4. Closing the sidebar must not erase the remembered width.
  app.actions.toggleSidebar()
  await sleep(400)
  assert.deepEqual(JSON.parse(app.storage.get(STORAGE_KEY)), { sidebar: 360, rightbar: 560 })
  app.dispose()
}

// 5. Corrupt storage degrades to defaults instead of throwing.
{
  const app = boot({ stored: { [STORAGE_KEY]: '{not json' }, registerStore: true })
  assert.equal(app.state().layoutInfo.sidebar, SIDEBAR_DEFAULT)
  assert.equal(app.state().layoutInfo.rightbar, null)
  app.dispose()
}

console.log('layout-persist smoke: ok')
