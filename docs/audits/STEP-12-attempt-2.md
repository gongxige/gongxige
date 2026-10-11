# 审计报告：STEP-12 手机上铺满屏幕、竖屏自动横向显示（第 2 次）

- 时间：2026/10/11 18:43:15
- 审计的提交：408aa92（比较起点 STEP-11-passed）
- 结果：**通过**

---

## 结论
STEP-12 第 2 次提交已修复第 1 次审计提出的全部问题：规则弹窗移入 `.stage` 内随竖屏旋转一起转向、删除死代码 `.lobby-return`、并按规格把"手机判定"收紧为触屏且窄边 ≤600px。`npm test`、`npm run build` 均通过，范围未涉及 `src/engine/` 或无关文件，文档已更新。判定为 **PASS**。

## 运行的检查
- `npm test` → 通过，63/63
- `npm run build` → 通过（`tsc -b && vite build` 无错误）
- `git diff STEP-11-passed..HEAD --check` → 无空白/冲突标记问题
- `git diff 533b7e4..HEAD --stat`（533b7e4 为"阶段 8 计划"提交，紧邻 STEP-12 实际改动之前）→ 确认 STEP-12 本身只动了 `src/GameApp.tsx`、`src/styles.css`、`src/ui/TopBar.tsx` 及 `docs/`、`docs/workflow/` 下的流程记录文件，未触碰 `src/engine/`、`scripts/`、`docs/WORKFLOW_PLAN.md`；STEP-11 之后到 STEP-12 之间的其他提交（admin 密码、平台页面滚动修复、金币悬念动效、Cloudflare URL 修复）是之前已完成合入 main 的独立工作，不属于本次审计对象。
- `git diff 9b6356a..408aa92`（第 1 次 → 第 2 次提交）逐行核对：
  - `src/GameApp.tsx`：`{modal === 'rules' && <RulesModal .../>}` 已从 `<section className="stage">` 外移到内部（紧挨 `</section>` 前），成为 `.stage` 的后代。
  - `src/styles.css`：删除了无引用的 `.lobby-return` 与 `.lobby-return:hover`（已用 Grep 全项目确认再无引用，只在 DEVLOG 和上一次审计报告的文字描述里出现）；`@media (pointer: coarse)` 两条规则都加上了 `(max-width: 600px)` / `(max-height: 600px)` 的窄边限制；竖屏旋转分支新增 `.modal-card { max-height: calc(100dvw - 32px); }`。
- 手工推演 CSS 包含块逻辑确认修复是对的：
  - 竖屏旋转媒体查询里 `.stage` 有 `transform: rotate(90deg)`，这会把其内部 `position: fixed` 的 `.modal-backdrop` 的包含块从视口改为 `.stage` 的内边距盒（局部坐标，宽 100dvh、高 100dvw），随 `.stage` 整体一起被旋转，方向与已旋转的游戏画面一致，解决了第 1 次审计的中等问题。局部坐标系里纵向尺寸是 `100dvw`，所以把 `.modal-card` 的 `max-height` 同步改成 `calc(100dvw - 32px)` 是对的（原来固定用 `100dvh` 会在旋转后量错轴，可能把弹窗撑出屏幕或裁切内容）。
  - 桌面（1366×768）和手机横屏铺满（无旋转）两种情形下 `.stage` 没有 `transform`，`.modal-backdrop` 的包含块仍是初始包含块（视口），不受 `.stage` 的 `overflow: hidden` 裁切（无 transform/filter/contain 的祖先的 `overflow:hidden` 不裁切 `position:fixed` 后代，这是标准浏览器行为），行为与改动前一致，没有引入桌面回归。
- 检查 `docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`：均已补充第 2 次修正的记录，`DEVELOPMENT_PLAN.md` 的 STEP-12 勾选项标注"第 2 次审计修正已完成"。

## 问题
无（轻微建议亦无新增）。

## 给 Codex 的修改要求
无（PASS，不需要）。

VERDICT: PASS
