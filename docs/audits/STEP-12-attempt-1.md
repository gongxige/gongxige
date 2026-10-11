# 审计报告：STEP-12 手机上铺满屏幕、竖屏自动横向显示（第 1 次）

- 时间：2026/10/11 18:34:29
- 审计的提交：9b6356a（比较起点 STEP-11-passed）
- 结果：**不通过**

---

## 结论
STEP-12 的核心交付（手机全屏铺满、竖屏旋转、演示提示移入顶部信息条、主页图标按钮）构建和测试均通过，范围控制得当（未触碰 `src/engine/`，文档已更新）。但发现一处中等问题：规则弹窗（RulesModal）在竖屏触屏模式下不会跟随舞台一起旋转，导致点开"规则与赔率"时内容方向与已旋转的游戏画面不一致。判定为 **FAIL**。

## 运行的检查
- `npm test` → 通过，63/63
- `npm run build` → 通过（`tsc -b && vite build` 无错误）
- `git log/show/diff STEP-11-passed..HEAD` → 确认 STEP-12 实际改动仅在提交 `9b6356a`（`docs/DEVELOPMENT_PLAN.md`、`docs/DEVLOG.md`、`docs/workflow/state.json`、`src/GameApp.tsx`、`src/styles.css`、`src/ui/TopBar.tsx`），范围内未涉及 `src/engine/` 或其他无关文件；STEP-11 之后到 STEP-12 之前还有几条非 autopilot 步骤的手工提交（admin 密码、UI 滚动修复、金币悬念动效、Cloudflare 隧道 URL 修复），这些是之前已完成并合入 main 的独立工作，不属于本次 STEP-12 的审计对象，已排除在外。
- 代码级审阅 `src/styles.css` 新增的 `@media (pointer: coarse)` / `(pointer: coarse) and (orientation: portrait)` 规则：逐项核算了竖屏旋转后 `safe-area-inset-*` 四个方向的映射关系（`rotate(90deg)` 下局部左↔物理上、局部右↔物理下），映射是对的；核算了 390×844、844×390 两种尺寸下 `cqw` 换算与图标按钮可点击尺寸（约 45px，足够触控）。
- 未能用真实浏览器/设备核对 390×844、844×390、1366×768 下的实际渲染与点击（本环境没有浏览器自动化工具，和 Codex 在 DEVLOG 里说明的限制一致），以下结论基于 CSS 语义推导，不是像素级实测。

## 问题
- [中等] `src/GameApp.tsx`:230（`{modal === 'rules' && <RulesModal ... />}`）与 `src/styles.css`:130（`.modal-backdrop { position: fixed; ... }`）— `RulesModal` 渲染在 `<section className="stage">` 之外（`<main>` 的兄弟节点），而竖屏触屏的旋转是加在 `.stage` 本身的 `transform: rotate(90deg)` 上。CSS 规范里，有 `transform` 的元素会给它的 `position: fixed` 后代创建新的包含块；但 `RulesModal` 不是 `.stage` 的后代，所以它的 `fixed` 定位仍以未旋转的视口为基准。结果：手机竖屏（如 390×844）时游戏画面已经旋转 90° 显示为横向，玩家点右上角"ⓘ"打开规则弹窗时，弹窗会以真实竖屏方向出现，与已经旋转的游戏画面方向不一致，造成明显的方向错位体验。这是本步新引入旋转机制后才会暴露的问题，此前没有旋转，不存在这个不一致。
  - 应该怎么改：让 `RulesModal` 也跟随旋转，例如把 `{modal === 'rules' && <RulesModal .../>}` 移到 `<section className="stage">` 内部（这样它的 `fixed` 定位会因为祖先有 `transform` 而被限制在 `.stage` 的变换盒内，天然跟着一起转），或者在同一个 `@media (pointer: coarse) and (orientation: portrait)` 里给 `.modal-backdrop` 补一条等效的 `transform: rotate(90deg)` 规则，旋转后记得同步调整它内部的宽高/滚动方向。改完后建议在竖屏模式下实际点开规则弹窗核对方向。

- [轻微] `src/styles.css`:200-201（`.lobby-return` 和 `.lobby-return:hover`）— 本次把 `<a className="lobby-return" href="/">返回大厅</a>` 从 `src/GameApp.tsx` 删除后，这两条 CSS 规则已经没有任何地方引用（已用 `grep` 全项目确认），变成死代码。
  - 应该怎么改：顺手删掉这两条规则。

- [轻微] `docs/GAME_POLISH_SPEC.md`:37 提到竖屏判定条件是"触屏、窄边 ≤ 600px"，但实现里只用了 `@media (pointer: coarse)`，没有再加宽度上限。对本次验收的三个尺寸（390×844、844×390、1366×768）没有影响，但触屏笔记本/平板横屏使用大屏时也会被当成"手机"强制铺满+可能的旋转逻辑，与规格描述不完全一致。
  - 应该怎么改：如果要严格对齐规格，可以加一个 `and (max-width: 600px)`（配合 orientation 用 `max-width`/`max-height` 分别约束窄边）；如果产品上能接受触屏设备一律按手机处理，也可以在 DEVLOG 里写清楚这是有意简化，供下一位审计/开发参考。

## 给 Codex 的修改要求
1. 修复规则弹窗方向：把 `RulesModal` 的渲染位置移进 `<section className="stage">` 内部（放在 `</section>` 之前即可），让它随 `.stage` 的 `rotate(90deg)` 一起转；或者单独给 `.modal-backdrop` 在竖屏触屏媒体查询里加同样的旋转变换，并确认旋转后弹窗的宽高、内部表格滚动方向仍然正常可用。
2. 删除 `src/styles.css` 里已经没用的 `.lobby-return` 和 `.lobby-return:hover` 两条规则。
3. 修完后重新跑 `npm test`、`npm run build`，并在 DEVLOG 里补一条说明：如何核对竖屏下打开规则弹窗的方向是否与已旋转的游戏画面一致。
4. 可选：如果要严格贴合 `GAME_POLISH_SPEC.md` 里"窄边 ≤ 600px"的判定条件，补上宽度/高度上限；如果不打算补，就在 DEVLOG 里写明这是有意简化。

VERDICT: FAIL
