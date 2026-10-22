//#region src/index.ts
/**
* @lim324/dsh-layout-persist — host half.
*
* The whole behavior is a Web client surface (see `./client/index.ts`); this
* half exists only so the package is a valid Cordis plugin the profile loader
* can mount. The Web shell discovers the browser bundle from the package's
* `dsh.client` metadata and mounts it next to the other client modules — no
* host service, route, or configuration is needed.
*
* @module @lim324/dsh-layout-persist
*/
/** Stable Cordis plugin name. */
const name = "layout-persist";
/** Mount a no-op host plugin: the width memory lives in the browser half. */
function apply() {}
//#endregion
export { apply, name };
