window.__ModuleLoader__.load({
	id: "@lim324/dsh-layout-persist",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
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
		/**
		* Whether a persisted field is a usable width.
		* @param value - raw decoded field.
		* @returns true for a positive finite number.
		*/
		function isWidth(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0;
		}
		/**
		* Read the persisted widths, tolerating absent, foreign, and corrupt payloads.
		* @returns the valid saved widths (possibly empty).
		*/
		function readSaved() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (raw === null) return {};
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) return {};
				const record = parsed;
				const saved = {};
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
		function findLayoutStore(ctx) {
			for (const entry of ctx.slots.entries("root")) {
				const seat = entry.store;
				if (seat === void 0 || typeof seat === "function") continue;
				const probe = seat.spec?.init?.();
				if (typeof probe !== "object" || probe === null) continue;
				if (typeof probe.layoutInfo?.sidebar !== "number") continue;
				return {
					entry,
					handle: seat
				};
			}
		}
		/**
		* Client plugin body: follow the layout store's registration, restore the saved
		* widths into it once, then mirror every later width change back to storage.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				let attached;
				let instance;
				let disposeStore;
				let timer;
				/** Current width memory; kept in memory so a closed sidebar keeps its width. */
				let preference = {};
				/** Last payload written, to skip no-op writes and re-renders. */
				let lastWritten = "";
				/**
				* Fold the current widths into the memory and write it.
				*
				* Only positive widths are folded in: a closed sidebar reports 0, which is
				* not a width and must keep the remembered value instead of erasing it.
				*/
				const persist = () => {
					timer = void 0;
					if (instance === void 0) return;
					const { layoutInfo } = instance.getSnapshot();
					if (layoutInfo.sidebar > 0) preference.sidebar = Math.round(layoutInfo.sidebar);
					if (layoutInfo.rightbar !== null && layoutInfo.rightbar > 0) preference.rightbar = Math.round(layoutInfo.rightbar);
					const serialized = JSON.stringify(preference);
					if (serialized === lastWritten) return;
					lastWritten = serialized;
					try {
						window.localStorage.setItem(STORAGE_KEY, serialized);
					} catch {}
				};
				/** Coalesce a burst of drag updates into one write. */
				const schedulePersist = () => {
					if (timer !== void 0) return;
					timer = setTimeout(persist, SAVE_DELAY_MS);
				};
				/** Seed the live store from storage; runs once per store instance. */
				const restore = (live) => {
					const saved = readSaved();
					preference = saved;
					lastWritten = JSON.stringify(saved);
					const { layoutInfo } = live.getSnapshot();
					if (saved.sidebar !== void 0 && Math.round(layoutInfo.sidebar) !== saved.sidebar) live.actions.setSidebar(saved.sidebar);
					if (saved.rightbar !== void 0 && layoutInfo.rightbar === null) live.actions.setRightbar(saved.rightbar);
				};
				/** Attach to the root store seat once, or re-attach when it is replaced. */
				const attach = () => {
					const found = findLayoutStore(ctx);
					if (found === void 0 || found.entry === attached) return;
					disposeStore?.();
					attached = found.entry;
					const live = found.handle.create();
					instance = live;
					restore(live);
					disposeStore = live.subscribe(schedulePersist);
				};
				const disposeLedger = ctx.slots.subscribe("root", attach);
				attach();
				return () => {
					disposeLedger();
					disposeStore?.();
					if (timer !== void 0) clearTimeout(timer);
					timer = void 0;
					instance = void 0;
					attached = void 0;
				};
			}, "layout-persist: width memory");
		}
		/** Services required before the ledger subscription can mount. */
		const inject = ["slots"];
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
