# dsh-layout-persist

让 DSH Web 的左、右两侧栏宽度在**重启 dsh 后仍然保留**。

## 现象与根因

DSH Web 的左右栏宽度存在 layout 插件根 store 的 `layoutInfo` 里，而该 store
（`@deepseek-ai/dsh-client-ui-layout` 的 `createLayoutStore`）只声明了 `init`
和 `actions`，**没有声明 `persist`**：

- 左侧栏每次启动回到 `SIDEBAR_DEFAULT = 280px`；
- 右侧面板每次启动回到「首次打开时的 45% 视口宽」。

同一份核心代码里，主题、字号、会话正文栏宽（`dsh.conversation.contentWidth`）
都做了 localStorage 持久化，唯独布局宽度漏了 —— 所以这不是配置问题，改设置也
没有对应开关，重启必然回默认。

## 做法

一个极小的 Web client 插件：不 fork 核心，也不改 node_modules。

1. 订阅 `root` slot 的注册表，等 layout 插件挂上它的根 store
   （`StoredEntry.store` 是公开的 store seat，layout 把该 handle 的 `create()`
   钉死为活着的单例，所以拿到的就是页面正在用的实例）；
2. 启动时把 `localStorage` 里的 `{ sidebar, rightbar }` 写回 store；
3. 之后每次宽度变化（拖拽 / 展开右栏）在 250ms 防抖后回写 `localStorage`。

存储键：`dsh.layout.widths.v1`，形如 `{"sidebar":372,"rightbar":500}`，字段都可缺省。
删掉这个键即回到默认宽度。

### 行为细节

- **关闭左侧栏不会抹掉宽度**：`sidebar = 0` 不是宽度，不写入；下次启动按记忆的宽度展开。
- **右栏只在「还没有宽度偏好」时回填**：面板 occupant 报上来的宽度优先；存储值会经过
  store 自身的 `300..70% 视口` 夹取，换显示器不会炸。
- **失败就退化成原始行为**：localStorage 不可用（无痕 / 配额）只丢记忆，不影响渲染；
  layout store 若将来换了形状，插件找不到 seat 就不 attach，不会报错、不会白屏。

## 安装

### 从 GitHub 装（推荐）

```bash
dsh plugin --profile web add "github:Limsanity/dsh-layout-persist"
```

本包带 `cordis.patch.yml`（`dsh.bundle.patch`），plugin manager 会把它登记成
profile bundle 并自动挂载；**重启 dsh** 后生效。

### 从本地目录 link

```bash
cd ~/.dsh/profiles/web
pnpm add "link:/path/to/dsh-layout-persist"
```

link 安装不会自动挂载，需要在 `~/.dsh/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: layout-persist
      name: '@lim324/dsh-layout-persist'
```

装完重启 dsh，拖一次左右栏把宽度写进 localStorage，以后每次重启都沿用。

## 升级 DSH 后

插件只依赖两件事：`root` slot 上 layout 的 store seat，以及 `layoutInfo` 里的
`sidebar` / `rightbar` 字段与 `setSidebar` / `setRightbar` 两个 action。核心若改了
store 形状（例如自己补上 `persist`，或改成 factory 形式的 store seat），插件会
安静地不 attach —— 此时要么删掉本插件，要么按新形状改 `src/client/index.ts`。

## 开发与验证

```bash
pnpm install
pnpm run build      # lib/index.js（host，空实现）+ lib/client.js（浏览器 bundle）
pnpm run smoke      # 离线：vm 里跑打包产物 + 假 store，覆盖回填/回写/关栏不覆盖/脏数据
pnpm run typecheck
```

`scripts/e2e-cdp.mjs` 是真实浏览器端到端脚本（隔离 DSH home + headless Chrome over CDP）：
断言「默认 280 → 写入 320 后重载真的渲染成 320 → 拖到 372 被写回 localStorage
→ 再重载仍是 372」。本机实测结果：

```
1. fresh: 280 stored: null
2. restored: 320 stored: {"sidebar":320,"rightbar":500}
3. after drag: 372 stored: {"sidebar":372,"rightbar":500}
4. after reload: 372 stored: {"sidebar":372,"rightbar":500}
layout-persist e2e: ok
```

## 文件

- `src/client/index.ts` — 全部行为；
- `src/index.ts` — host 侧空插件（只为了让包能被 profile loader 挂载）；
- `tsdown.config.ts` — host ESM + 浏览器 bundle（`window.__ModuleLoader__.load` 包装）；
- `lib/` — 构建产物（刻意提交，见 `.gitignore` 说明）。
