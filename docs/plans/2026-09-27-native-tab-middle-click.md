# 原生右侧栏的中键关闭（v0.21.2）

**状态**：已实现（本分支 `fix/native-tab-middle-click-minimal`），真机挂载 7/7 通过。
**前置**：PR #621（`fix/native-tab-middle-click`，2026-09-10 关闭，未合并）——同一目标，但是按 0.1.5 的宿主契约写的，且与 main 有 3 处冲突。本文档记录**重写**而非移植的取舍。

## 1. 问题

v0.19.0 把右列交给 DSH 原生右侧栏后，右侧栏 tab 的**中键关闭失效**（插件底部工作台照旧）。这不是插件回归：宿主的 tab 条从来没有实现这个手势。

宿主 tab 元素（`ui-sidebar-right` 的 dockkit strip）挂四个处理器，从 0.1.7-rc.1 到 rc.2 逐字未变：

| 处理器 | 行为 |
|---|---|
| `onPointerDown`（`button !== 2`） | `onTabPressed` → 拖拽跟踪 |
| `onClick` | 激活 |
| `onKeyDown` | 方向键 / Home / End / Enter / Space |
| `onContextMenu` | 右键菜单（`data-dockkit-menu-close`） |

**没有任何 `button === 1` 分支**，也没有键盘关闭绑定。关闭入口只有两个：× 按钮（`data-dockkit-tab-close`）与右键菜单项。

## 2. 相比 PR #621 砍掉了什么

#621 的方案依赖三种「插件自己造的身份」，重写时逐一验证后**全部不需要**：

| #621 的机制 | 结论 |
|---|---|
| 标题 chip 打 `data-dsh-better-sidebar-native-tab` 标记 | **保留**（见 §4，宿主两版都不提供可用的等价 stamp） |
| `NativeTabTitle` 之外再包一层标记元素 | 保留，但**必须是 `display: contents`**（§3） |
| 控制器建 `Map<tabId, close>` 并在标题 chip 里 `register`/回收 | **保留**（归属判定必需） |
| 命中判定里再做 `closest(HIT_NODE_SELECTOR)` + 关闭控件探测（`canCloseTab` 二次判断） | **删除**：`actions.close()` 本身就是宿主 × 按钮的调用，宿主拒绝关闭时该 action 不存在 |
| 会话精确性靠结构化探测 `closeIn` | **删除**：`tab.actions.close()` = `navigator.closeIn(sessionId, tabId)`，会话由宿主绑定 |

净结果：实现 194 行（#621 是 200 行），测试 152 行 / 9 例（#621 是 333 行 / 14 例）。

## 3. 关键发现：宿主 title 槽是 `display: contents`

`ui-sidebar-right` 的 CSS 里 `.P3OORG_tabTitle{display:contents}`——宿主自己的标题元素不生成盒子，chip 的「图标 + 标题」因此直接成为 dockkit 那个 flex tab 元素的子元素。

后果：插件若在标题槽里包一层会生成盒子的元素，chip 的布局会变（图标/标题的 flex 关系断掉）。所以标记必须骑在 `display: contents` 的 wrapper 上。**这一条是本实现最容易踩空的地方**，由 `tests/native-surface.spec.ts` 的「stamps the ownership marker on a layout-neutral wrapper」用例钉住。

## 4. 关键发现：不能用宿主的 stamp 做归属（真机抓到）

第一版实现「借用宿主盖在 tab 元素上的 `data-sidebar-right-tab`（值就是 native tab id）做身份」，在本地读 0.1.7-rc.2 的全局安装包时**看起来成立**：

- `TabSlot` 渲染 title 时确实包了 `<span className={tabTitle} data-sidebar-right-tab={tab.id} data-sidebar-right-occurrence={id}>`。

但真机挂载 lane 用的是**脚本回退的 rc.1**（CI 基线），当场失败：

```
Error: the host must stamp its native tab id on the chip (the ownership the plugin reads)
Expected: 1  Received: 0
```

逐包核对后确认：

| stamp | 0.1.7-rc.1 | 0.1.7-rc.2 |
|---|---|---|
| `data-dockkit-tab`（strip chip，值是 native tab id） | ✅ | ✅ |
| `data-sidebar-right-tab`（title 槽外壳） | ❌ **不存在** | ✅ |
| `data-dockkit-tab-close` / `-menu-close` / `-float-grip` | ✅ | ✅ |

rc.1 的 `TabSlot` 直接 `return renderSlot(...)`，没有外包层。`data-dockkit-tab` 两版都有，但它**同时也在宿主 tab 上**，只能做身份不能做归属。

**结论**：归属必须由插件自己的标记承担；身份可以同时从标记取（避免混用两个来源）。这正是 #621 保留 marker 的理由，但理由与它写的不一样——不是「拿不到 chip 外壳」，而是「宿主 stamp 跨版本不一致」。

## 5. 实现的最终形状

`src/client/native/tab-middle-click.ts`（新，194 行）：

1. `NATIVE_TAB_MARKER = 'data-dsh-better-sidebar-native-tab'`：标题 chip 盖在 `display: contents` wrapper 上，值 = native tab id（归属 + 身份）。
2. 文档级**捕获**监听 `pointerdown`/`mousedown`（+ `pointerup`/`mouseup`/`pointercancel`/`blur`）：
   - 按下命中 `[data-dockkit-tab], [data-dockkit-float-grip]` 内**带标记**的 chip → `preventDefault()`（关掉 Chrome 中键自动滚动）+ `stopPropagation()`（宿主的拖拽跟踪挂在 pointerdown 上，否则中键会开始拖 tab）；
   - 释放落在同一 box 内、且漂移 ≤ 4px（`DRAG_SLOP`）才关；换位置 / 漂移 / 元素已卸载 → 取消。
3. 每个标题 chip 在 `useEffect` 里 `register(tabId, actions.close)`，卸载即回收（回收带「owner 比对」，重渲染不会误撤新的 action）。
4. 控制器**每次客户端激活新建**（非模块单例），随 `registerNativeSurface` 的 disposer 一起 `dispose()`，不在 document 上留悬挂监听。

宿主 tab（内置指南、宿主终端）没有标记 → 完全不碰：不 `preventDefault`、不 `stopPropagation`，左键/拖拽/右键菜单/方向键全部照旧。

## 6. 验证

- 单测 `tests/native-tab-middle-click.spec.tsx`（9 例）：命中与关闭、`preventDefault`/`stopPropagation`、宿主 tab 不受影响、换位置释放取消、漂移取消、单次结算、按下期间 tab 被卸载、owner 回收语义、`dispose` 解绑、标记形状。
- `tests/native-surface.spec.ts` 新增 1 例钉住 `display: contents` wrapper；既有 20 例随 `middleClick` 注入同步。
- **真机**（`@deepseek-ai/dsh@0.1.7-rc.1` + 真实 `dsh web` + 真实 Chromium）：`pnpm test:mount` 7/7 通过，含新断言「中键点击真的让宿主 store 里的 tab 消失」。
- `tsc --noEmit` 0 错、`eslint .` 干净、全量单测 114 文件 / 1142 例通过。

## 7. 风险与边界

- 依赖宿主两个 DOM 事实：`data-dockkit-tab`（strip chip）与 `data-dockkit-float-grip`（浮动面板表头）。上游改结构时退化为「手势失效」，不会误伤宿主 tab。
- 浮动面板的正文区（编辑器 / 网页）**不在**命中范围内：那里的中键是粘贴 / 后台打开。
- 宿主的拖拽跟踪理论上仍可能在某次布局中让中键拖动生效；`DRAG_SLOP` 保证这种拖动的释放不会关掉 tab。
