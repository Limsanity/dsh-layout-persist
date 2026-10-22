/**
 * End-to-end check against a real DSH Web instance (see README: "Verified
 * end-to-end"). Not part of the normal build — it drives the layout through a
 * live browser over CDP, so it needs:
 *
 *   1. a throwaway DSH home with this plugin mounted, e.g.
 *        DSH_HOME=/tmp/dsh-lp-home dsh web --no-open --port 3999
 *   2. the DSH Chrome instance in headless mode on that URL, e.g.
 *        $HOME/.dsh/bin/dsh-chrome start-headless   (or the equivalent
 *        `--headless=new --user-data-dir=$HOME/.dsh/chrome-agent` command)
 *   3. CDP reachable on :9333 (`dsh-cdp tabs`)
 *
 * Target overrides: DSH_E2E_CDP (default http://127.0.0.1:9333) and DSH_E2E_APP
 * (default 127.0.0.1:3999).
 *
 *  1. wide viewport → sidebar at the 280px default, nothing stored;
 *  2. plant saved widths + reload → sidebar renders at the saved 320px;
 *  3. drag the handle with trusted mouse input → the plugin mirrors the new
 *     width into localStorage after its debounce;
 *  4. reload again → the dragged width survives.
 */
const CDP = process.env.DSH_E2E_CDP ?? 'http://127.0.0.1:9333'
const APP = process.env.DSH_E2E_APP ?? '127.0.0.1:3999'
const targets = await (await fetch(`${CDP}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes(APP))
if (page === undefined) throw new Error('no page target for the isolated app')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let nextId = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    message.error === undefined ? resolve(message.result) : reject(new Error(JSON.stringify(message.error)))
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails !== undefined) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const sidebarWidth = () =>
  evaluate(`Math.round([...document.querySelectorAll('[class*=sidebarCol]')][0]?.getBoundingClientRect().width ?? -1)`)
const stored = () => evaluate(`localStorage.getItem('dsh.layout.widths.v1')`)

const dismissWelcome = () =>
  evaluate(`(()=>{
    const dialog = document.querySelector('[role=dialog]')
    const close = dialog?.querySelector('button[aria-label=Close]') ?? dialog?.querySelector('button[class*=close]')
    close?.click()
    return close !== undefined
  })()`)

const handleAt = (y) =>
  evaluate(`(()=>{const h=[...document.querySelectorAll('[class*=handle]')].find(e=>e.getAttribute('data-side')==='sidebar');if(!h)return null;const r=h.getBoundingClientRect();const x=r.left+r.width/2;return {x,y:${y},hit:document.elementFromPoint(x,${y})?.getAttribute('data-side')}})()`)

const waitForSidebar = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const width = await sidebarWidth().catch(() => -1)
    if (width > 0) return width
    await sleep(200)
  }
  throw new Error('sidebar never rendered')
}

const reload = async () => {
  await send('Page.reload', { ignoreCache: false })
  await sleep(1200)
  await waitForSidebar()
  await sleep(300)
  for (let attempt = 0; attempt < 10; attempt++) {
    await dismissWelcome()
    await sleep(250)
    const probe = await handleAt(400)
    if (probe !== null && probe.hit === 'sidebar') break
  }
  return sidebarWidth()
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 900, deviceScaleFactor: 1, mobile: false })

// 1. Fresh storage: default 280px.
await evaluate(`localStorage.removeItem('dsh.layout.widths.v1')`)
let width = await reload()
console.log('1. fresh:', width, 'stored:', await stored())
if (width !== 280) throw new Error(`expected the 280px default, got ${width}`)

// 2. Saved widths are restored into the live store on boot.
await evaluate(`localStorage.setItem('dsh.layout.widths.v1', JSON.stringify({ sidebar: 320, rightbar: 500 }))`)
width = await reload()
console.log('2. restored:', width, 'stored:', await stored())
if (width !== 320) throw new Error(`expected the restored 320px sidebar, got ${width}`)

// 3. A trusted drag on the handle is mirrored back after the debounce.
const handle = await handleAt(400)
console.log('   handle:', handle)
if (handle === null) throw new Error('no sidebar drag handle rendered')
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 })
for (const dx of [10, 25, 40, 52]) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + dx, y: handle.y, button: 'left', buttons: 1 })
  await sleep(60)
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 52, y: handle.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(800)
const draggedWidth = await sidebarWidth()
console.log('3. after drag:', draggedWidth, 'stored:', await stored())
const dragged = JSON.parse((await stored()) ?? 'null')
if (draggedWidth === 320) throw new Error('the drag never moved the sidebar')
if (dragged === null || dragged.sidebar !== draggedWidth) throw new Error(`drag was not persisted: ${JSON.stringify(dragged)} vs ${draggedWidth}`)
if (dragged.rightbar !== 500) throw new Error(`right panel preference was lost: ${JSON.stringify(dragged)}`)

// 4. Reload keeps the dragged width — the restart scenario this plugin exists for.
width = await reload()
console.log('4. after reload:', width, 'stored:', await stored())
if (width !== draggedWidth) throw new Error(`expected ${draggedWidth}px after reload, got ${width}`)

console.log('layout-persist e2e: ok')
ws.close()
