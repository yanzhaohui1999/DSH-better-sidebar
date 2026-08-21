# 编辑器 Git 联动（blame + 变更标注 + 文件树徽标）设计

**日期**：2026-08-21
**状态**：设计先行，实施分 PR（B1 → B2 → B3）
**作者**：opencode + 用户
**关联 issue**：[#212](https://github.com/omdsh-dev/DSH-better-sidebar/issues/212)（enhancement / P2）、[#131](https://github.com/omdsh-dev/DSH-better-sidebar/issues/131)（重叠边界见 §5.1）
**目标版本**：v0.14.x（不 bump）

## 1. 目标

1. **变更标注（B2）**：编辑器行号列对当前未提交的改动着色——新增行绿、修改行橙、删除块红三角锚点，改动块代码行轻微背景着色；保存 / 切换文件后自动刷新。
2. **行级 blame（B3）**：viewport 内每行标注最后一次修改的提交（gutter 短作者 + hoverTooltip 完整信息：作者 / 日期 / 说明 / hash）；选中一段代码时按选区范围拉取；未提交行显示「未提交」。
3. **文件树联动（B1）**：文件树 / 资源管理器中对有未提交变更的文件显示状态徽标并着色（新增绿 / 修改橙 / 删除红 / 未跟踪灰 / 冲突红），点击带徽标文件在编辑器打开并定位到首个变更行。
4. 全部复用现有能力 + 最小公共 API 增量；**不改 DSH 源码**；CM 依赖全部留在懒加载 chunk。

## 2. 非目标（Out of Scope）

- 不做 GitLens 全量能力：字段级显隐开关（作者 / hash / 日期分别开关）、热力图、邮箱头像、blame 时间线弹窗。
- 不做 markdown/html viewer 的标注（v1 只挂 `code` viewer）。
- 不做 AI 提交信息、commit 下拉（另一条线）。
- 不引入新 npm 依赖（`@codemirror/state` / `@codemirror/view` 已在 devDeps，编辑器在懒加载 chunk 内使用）。
- **核心 bundle 禁止静态 import `@codemirror/*`**(既有懒加载契约, `docs/plans/2026-08-12-lazy-chunks-design.md`)。

## 3. 现状盘点（已核实，代码为准）

| 能力 | 现状 | 出处 |
|---|---|---|
| 单文件 diff 文本 | ✅ host `git.diff`（`--no-color -U3`，staged/unstaged） | `src/git.ts:158` + 路由 `git.diff` |
| unified diff 解析（行号映射） | ✅ `parseUnifiedDiff` 纯函数，`DiffLine{kind,oldNum,newNum}` | `src/client/DiffView.tsx:70`（已在核心 bundle，DiffTab 使用） |
| 状态条目（xy 码） | ✅ `git.status` 返回 `{isRepo, branch, entries:{path,xy}[]}`；路径为**仓库根相对**（无 root 字段，无法客户端拼绝对路径） | `src/git.ts:147` + 路由 |
| 编辑器 | ✅ CM6，`EditorState.create` 内静态 extensions 数组；`viewRef` 持有 EditorView；保存走 `api.fsWrite` | `src/client/TextEditor.tsx:135-164` |
| 懒加载边界 | ✅ `chunks/editor.tsx` 只导出 `TextEditor`；`viewers.tsx` 经 `lazyChunkComponent('editor', m => m.TextEditor)` 注册 `code`/`markdown`/`html` | `src/client/builtins/viewers.tsx:46,79,101,110` |
| 服务打开文件 | ✅ `openFile(scope, path, title?)` → `openTab({type:'editor', path, id:'editor:'+path})`；**无 meta 参数** | `src/client/service.ts:785` |
| tab meta | ✅ `SidebarTab.meta?: unknown`（v0.12.0+，随 tab 持久化） | `src/client/state.ts:31` |
| 设置 seam | ✅ `pluginToggles`（值持久化在 `pluginSettings[<id>]`） | `src/client/SideCardSection.tsx:533` |
| blame | ❌ host/client 均无 | — |

## 4. 公共 API 变更（全部向后兼容 + 单调能力清单增项）

| 变更 | 形状 | 兼容性 |
|---|---|---|
| host `git.status` 响应**附加** `root?: string` | repo 顶层绝对路径（`git.repoRoot` 现成） | 纯增量字段，旧客户端忽略 |
| host **新路由** `git.blame` | `{ path, start, end }` → `{ lines: Record<number, { hash, author, date, summary, uncommitted? }> }`；非 repo / 路径不存在抛 `git-error`（client 静默） | 新方法，与既有 `git.*` 同款注册 |
| `FileViewerProps` 可选扩展 | `extensions?`、`onSaved?`、`initialLine?`（编辑类 viewer 消费，外部 viewer 忽略） | 可选字段，向后兼容 |
| `service.openFile` 增可选第四参 | `openFile(scope, path, title?, meta?: unknown)` → seed `meta` 透传；`features` 增 `'openFileMeta'` | 可选参数，向后兼容 |
| `chunks/editor.tsx` 增导出 `GitEditor` | 包装 TextEditor + git 扩展；`viewers.tsx` 的 `code` viewer 改指 `GitEditor`（`markdown`/`html` v1 不动） | chunk 内部，注册表不变 |

## 5. 三 PR 拆分

### 5.1 B1 — 文件树状态徽标 + 点击定位（S~M，先合）

**数据流**：
```
TreePanel（挂载 + 自身 refreshTick bump；EditorHost 内嵌 dock 同款）
  → api.gitStatus(scope) → map(path → kind)（用新 root 字段拼绝对路径：join(root, entry.path)）
  → FileTree 行渲染徽标
EditorHost：保存后经 FileViewerProps.onSaved 回调（TextEditor fsWrite 成功后调用）→ bump TreePanel 刷新
点击徽标行 → onOpenFile(path) 已存在
「定位到改动」：TreePanel 在打开时带首个变更行 → service.openFile(scope, path, title, { line })
  → tab.meta.line（随持久化）→ EditorHost 读 tab.meta.line → FileViewerProps.initialLine
  → TextEditor 视图创建后 dispatch(scrollIntoView)（仅首次/路径切换时，隐式幂等）
```
- kind 判定：`xy` 的 X（index）优先，否则 Y；`A→added`、`M/R/C→modified`、`D→deleted`、`??→untracked`、`U/AA/DD 冲突→conflict`；行内徽标短字（`A/M/D/?`）+ 令牌色（`--dsw-alias-state-success/warning/danger` + tertiary），仅文件行（目录行不标，目录状态聚合不去做）。
- 失败降级：非 repo → 不拉取、无徽标（与 Git 面板 notRepo 口径一致）；拉取失败静默（树不受影响）。
- **与 #131 边界**：issue 原文注明「文件树联动与 #131 第三项（explorer 着色）重叠；#131 未实施则一并实现」。当前 #131 只有图标项 PR（#178），着色无人占 → B1 直接实现完整版（徽标 + 跳转），PR 描述注明若 #131 后续单独做 explorer 着色则以 B1 为准合并口径。
- 测试：FileTree 徽标渲染组件测试（`file-tree-drop.spec.tsx` 同款 harness）+ kind 映射纯函数单测。

### 5.2 B2 — 变更标注（M）

**数据流**：
```
GitEditor（chunk 内，包装 TextEditor）
  挂载/路径切换/onSaved：
    api.gitDiff(scope, path, false) + api.gitDiff(scope, path, true)（并行）
  → 新纯函数 newLineKinds(diffText): Map<newLine, 'added'|'modified'> + deletionAnchor: 首个删除块新侧锚点行号[]
（文件级别注意：parseUnifiedDiff 支持多文件段，取 `+++ b/<path>` 匹配当前 path 的段，否则取唯一段）
  → 扩展注入：
    - gutter：lineNumbers 用 gutterMarker 对 added/modified 行着色、删除锚点行红色三角（CSS 类 in chunk css）
    - 行背景：Decoration.line 轻微着色（低对比度令牌，如 state-success/warning 的 10% alpha——令牌不允许 alpha 调整则用自带 rgba 常量并注明皮肤回退）
```
- **add vs modify 判定（hunk 级近似，PR 写明）**：hunk 内含 `-` 行 → 该 hunk 的 `+` 行标 `modified`（橙）；纯增 hunk 的 `+` 行标 `added`（绿）；`-` 行块之后的第一条 `+`/ctx 行的 newNum 作为该删除块的红三角锚点（新侧视图中删除行不存在）。
- 刷新时机：保存（`onSaved`）后重拉；切换文件自然重挂；不监听磁盘（KISS，与 GitView 口径一致）。
- 开关：`editor` descriptor `settings.pluginToggles`：`changelogHighlight`（switch，缺省 on）。
- 测试：`newLineKinds` 纯函数单测（含 staged/unstaged 合并、删除锚点）；组件测试用 `editor-host.spec.tsx` 同款 jsdom harness 断言 gutter DOM 类。

### 5.3 B3 — blame（M~L，最后合）

**host**（`src/git.ts` + 路由）：
```
blame(cwd, path, start, end): git blame --porcelain -L <start>,<end> --no-color -- <path>
  → 纯解析（新函数 parseBlamePorcelain）→ Record<line, {hash, author, date, summary, uncommitted}>
  uncommitted 判定：porcelain 行为 0000000 全零 hash（issue 已实测）
  边界：未跟踪文件 / 非 repo → git 128 → GitCommandError → 路由兜底抛 SidebarError('git-error', ...)
```
**client（chunk 内 GitEditor 扩展）**：
```
ViewPlugin<{start,end}>：视口变化（viewportEffect）+ 节流（~300ms）
  → api.gitBlame(scope, path, start, end)（命中内存缓存 Map<path, Map<line, Blame>> 跳过）
  → 写入 StateField<Map<line, Blame>>
gutter/行尾标注：StateField 驱动 gutterMarker（短作者名，≤4 字截断；uncommitted 显「未提交」灰字）
hoverTooltip：CM6 hoverTooltip + 异步（create 内 fetch 缺行数据，先占位后填充）
选中区：DOMSelection 变化且非空 → 对选区行范围拉取（同缓存），覆盖 viewport 策略
```
- 交互开关：`pluginToggles`：`blameInline`（行内标注，缺省 off——默认不打扰，hover 仍可用?）——v1 定：`blameInline` 缺省 **on**（issue 诉求「光标行行尾显示可一键开关」），字段级开关不做。
- 测试：`parseBlamePorcelain` 纯函数单测（含 0000000 与边界输入）；host 路由测试（mock `runGit` 或 fixture 模式，照 `tests/git.spec.ts`）；Chunk 内扩展不做 DOM 测试（chunk 不可静态 import，jsdom harness 经 lazyChunkComponent 的现有 editor-host 路径验证 Smoke）。

## 6. 测试与验收（每 PR）

- `pnpm typecheck` + vitest 新用例全绿；全量测试不新增失败（现存 23 个 PTY `posix_spawnp` 环境性失败与改动无关，已于干净 main 复现）。
- CI `plugin-mount` 门禁不受影响：无新 tab、无新 chunk（GitEditor 复用 `editor` chunk）、核心 bundle 不引 CM。
- 手动验收（重启 `dsh web` 后）：树徽标随保存/刷新更新；改文件见行号着色；悬停见 blame 信息；未提交行显「未提交」；untracked/非 repo 无报错；设置页开关生效。

## 7. 风险与决策记录

| 决策 | 理由 |
|---|---|
| provider 无关：blame 路由结构化返回（host 解析），client 零 porcelain 逻辑 | 单一解析器 + 单测；wire 形状稳定 |
| B2 的 add/modify 为 hunk 级近似 | unified diff 无法可靠区分「整行改」与「行替换」；近似与 VSCode 观感一致，PR 注明 |
| 树徽标只标文件行、不做目录聚合计 | 目录聚合需要增量树递归，复杂度不值 v1 |
| `pluginSettings`（localStorage）存开关，host 无感知 | 开关纯客户端渲染语义，无需 host 配置通道 |
| GitEditor 在 chunk 内合并实现 B2+B3 扩展 | 核心 bundle 不引 CM 的既有契约 |
| openFile meta 走 `features` 单调清单 | 消费插件可特性探测 |

## 8. 实施偏差记录
（实施时追加：与本文不符的落地决策、review 修正、实测发现）