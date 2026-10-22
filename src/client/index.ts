/**
 * @lim324/dsh-layout-persist — Web client half.
 *
 * The frame's left sidebar and right panel widths live in the layout plugin's
 * root `defineStore`, which declares no `persist` key: the store is rebuilt on
 * every page load, so a restart snaps the sidebar back to its 280px default and
 * the right panel to 45% of the frame. Only the theme, font sizes, and the
 * transcript's content width are persisted by the shipped plugins today.
 *
 * This plugin mirrors the two width preferences into localStorage and writes
 * them back into the live layout store once it is registered. It reads that
 * store through the root slot's public store seat (`StoredEntry.store`): the
 * layout plugin pins the seat's `create()` to its live singleton, while the
 * public `ctx.layout` service deliberately exposes panel actions only (no
 * width setters), so the seat is the only supported handle.
 *
 * Persisted shape under `dsh.layout.widths.v1`:
 * `{ "sidebar": 300, "rightbar": 560 }` — every field optional. A closed
 * sidebar (`0`) is never written: it keeps the last width, so the next start
 * reopens at the remembered size instead of forgetting it (the upstream store
 * itself forgets a closed sidebar's width by design).
 *
 * Failure posture: storage errors (private mode, quota) only disable the
 * memory; they never break the frame.
 *
 * @module @lim324/dsh-layout-persist/client
 */

/** localStorage key of the width memory. Bump the suffix if the shape changes. */
const STORAGE_KEY = "dsh.layout.widths.v1";

/** Debounce for width writes: a drag emits a change per pointer event. */
const SAVE_DELAY_MS = 250;

/** Width preferences as persisted; absent fields mean "no preference". */
type SavedWidths = {
  /** Left sidebar width in px. Never `0`; a closed sidebar is not a width. */
  sidebar?: number;
  /** Right panel width in px; absent until its first opening. */
  rightbar?: number;
};

/** The slice of the layout store this plugin reads and restores. */
type LayoutSnapshot = {
  layoutInfo: {
    sidebar: number;
    rightbar: number | null;
  };
};

/** The baked write set of the layout store; only width setters are used. */
type LayoutActions = {
  setSidebar(px: number): void;
  setRightbar(px: number): void;
};

/** Live store instance face (the plugin's `create()` returns the live one). */
type LayoutStoreInstance = {
  getSnapshot(): LayoutSnapshot;
  subscribe(listener: () => void): () => void;
  actions: LayoutActions;
};

/** Store handle face: `spec` identifies the owner, `create` yields the instance. */
type LayoutStoreHandle = {
  spec?: { init?: () => unknown };
  create(): LayoutStoreInstance;
};

/** A registration's declared store seat: a shared handle or an exclusive factory. */
type StoreSeat = LayoutStoreHandle | (() => LayoutStoreHandle);

/** One stored slot registration, narrowed to the store seat this plugin needs. */
type StoreEntry = { store?: StoreSeat };

/** Client services this plugin touches (structural, so the bundle stays untyped). */
type ClientContext = {
  slots: {
    entries(key: string): readonly StoreEntry[];
    subscribe(key: string, listener: () => void): () => void;
  };
  effect(body: () => () => void, label?: string): void;
};

/**
 * Whether a persisted field is a usable width.
 * @param value - raw decoded field.
 * @returns true for a positive finite number.
 */
function isWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Read the persisted widths, tolerating absent, foreign, and corrupt payloads.
 * @returns the valid saved widths (possibly empty).
 */
function readSaved(): SavedWidths {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const saved: SavedWidths = {};
    if (isWidth(record.sidebar)) saved.sidebar = record.sidebar;
    if (isWidth(record.rightbar)) saved.rightbar = record.rightbar;
    return saved;
  } catch {
    return {};
  }
}

/**
 * Find the frame's root store seat and the registration that declared it.
 *
 * Only the layout plugin registers a store in the `root` slot, and it passes a
 * shared handle (an object), not an exclusive factory. The spec probe keeps the
 * plugin honest if another root store ever appears: a foreign handle's init
 * state has no `layoutInfo.sidebar`.
 * @param ctx - client context owning the slot ledger.
 * @returns the declaring entry and its handle, or undefined while unregistered.
 */
function findLayoutStore(ctx: ClientContext): { entry: StoreEntry; handle: LayoutStoreHandle } | undefined {
  for (const entry of ctx.slots.entries("root")) {
    const seat = entry.store;
    // A factory yields a private instance whose writes never reach the frame,
    // so only the shared-handle form is usable here.
    if (seat === undefined || typeof seat === "function") continue;
    const probe = seat.spec?.init?.();
    if (typeof probe !== "object" || probe === null) continue;
    const layoutInfo = (probe as { layoutInfo?: { sidebar?: unknown } }).layoutInfo;
    if (typeof layoutInfo?.sidebar !== "number") continue;
    return { entry, handle: seat };
  }
  return undefined;
}

/**
 * Client plugin body: follow the layout store's registration, restore the saved
 * widths into it once, then mirror every later width change back to storage.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    let attached: StoreEntry | undefined;
    let instance: LayoutStoreInstance | undefined;
    let disposeStore: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Current width memory; kept in memory so a closed sidebar keeps its width. */
    let preference: SavedWidths = {};
    /** Last payload written, to skip no-op writes and re-renders. */
    let lastWritten = "";

    /**
     * Fold the current widths into the memory and write it.
     *
     * Only positive widths are folded in: a closed sidebar reports 0, which is
     * not a width and must keep the remembered value instead of erasing it.
     */
    const persist = () => {
      timer = undefined;
      if (instance === undefined) return;
      const { layoutInfo } = instance.getSnapshot();
      if (layoutInfo.sidebar > 0) preference.sidebar = Math.round(layoutInfo.sidebar);
      if (layoutInfo.rightbar !== null && layoutInfo.rightbar > 0) preference.rightbar = Math.round(layoutInfo.rightbar);
      const serialized = JSON.stringify(preference);
      if (serialized === lastWritten) return;
      lastWritten = serialized;
      try {
        window.localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        // Private mode / quota: keep the frame working without a width memory.
      }
    };

    /** Coalesce a burst of drag updates into one write. */
    const schedulePersist = () => {
      if (timer !== undefined) return;
      timer = setTimeout(persist, SAVE_DELAY_MS);
    };

    /** Seed the live store from storage; runs once per store instance. */
    const restore = (live: LayoutStoreInstance) => {
      const saved = readSaved();
      preference = saved;
      lastWritten = JSON.stringify(saved);
      const { layoutInfo } = live.getSnapshot();
      if (saved.sidebar !== undefined && Math.round(layoutInfo.sidebar) !== saved.sidebar) {
        live.actions.setSidebar(saved.sidebar);
      }
      // The right panel starts with no width preference; only seed it when the
      // user has none yet, so a width reported by the occupant always wins.
      if (saved.rightbar !== undefined && layoutInfo.rightbar === null) {
        live.actions.setRightbar(saved.rightbar);
      }
    };

    /** Attach to the root store seat once, or re-attach when it is replaced. */
    const attach = () => {
      const found = findLayoutStore(ctx);
      if (found === undefined || found.entry === attached) return;
      disposeStore?.();
      attached = found.entry;
      const live = found.handle.create();
      instance = live;
      restore(live);
      disposeStore = live.subscribe(schedulePersist);
    };

    // The layout plugin registers its root store from its own effect: this
    // plugin may apply before it, so follow the ledger instead of polling.
    const disposeLedger = ctx.slots.subscribe("root", attach);
    attach();

    return () => {
      disposeLedger();
      disposeStore?.();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      instance = undefined;
      attached = undefined;
    };
  }, "layout-persist: width memory");
}

/** Services required before the ledger subscription can mount. */
export const inject = ["slots"] as const;
