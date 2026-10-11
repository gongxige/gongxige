# 审计报告：STEP-13 顶部信息条、底部按钮条、MAX、自动旋转（第 1 次）

- 时间：2026/10/11 18:52:48
- 审计的提交：26ba94d（比较起点 STEP-12-passed）
- 结果：**不通过**

---

## 结论
STEP-13 的 `npm test`（69/69）和 `npm run build` 都通过，范围未涉及 `src/engine/`，文档已更新。但核心验收项"旋转中不能改投注、不能按 MAX"在**自动旋转**场景下没有真正做到：每次自动旋转之间都有一段 `spinning === false` 的间隙，此时投注 `−`/`+` 和 MAX 按钮都是可点的，玩家可以在自动旋转进行中改变投注或跳到最高档。判定为不通过。

## 运行的检查
- `npm test` → 69/69 全部通过
- `npm run build`（`tsc -b && vite build`）→ 通过
- `git diff STEP-12-passed..HEAD --stat` → 仅改了 `src/GameApp.tsx`、`src/game/autoSpin.ts`（新增）、`src/game/game.test.ts`、`src/styles.css`、`src/ui/ControlBar.tsx`、`src/ui/TopBar.tsx` 和两份文档，未碰 `src/engine/`，范围正常
- 通读 `src/GameApp.tsx`、`src/ui/ControlBar.tsx`、`src/game/autoSpin.ts`、`src/game/game.test.ts` 的逐行逻辑（未用浏览器，按项目规则）

## 问题
- [严重] `src/GameApp.tsx:256`（`betLocked={spinning || inFreeSpins}`，被 `src/ui/ControlBar.tsx` 的投注 `−`/`+` 按钮和 MAX 按钮共用）— 自动旋转的次数递减发生在 `spin(true)` 调用那一刻（`GameApp.tsx:126-129`），而每次这局结算后 `setSpinning(false)`（`GameApp.tsx:140`）到下一次 `setTimeout(() => spinRef.current(true), 280)`（`GameApp.tsx:185`）真正开始下一局之间，`spinning` 是 `false`、`autoRemaining` 仍不是 `null`（按钮显示"剩余 N"/STOP）。这段至少 280ms 的间隙里 `betLocked` 为 `false`，投注 `−`/`+` 和 MAX 都可以点。玩家可以在"剩余 48"这种自动旋转进行中改投注或按 MAX，下一局自动旋转就会用新的投注下注，直接违反验收标准"旋转中不能改投注、不能按 MAX"。应改为 `betLocked={spinning || inFreeSpins || autoRemaining !== null}`（MAX 按钮同理）。
- [中等] `src/game/autoSpin.ts` 的 `AutoSpinController` 类定义了完整的次数递减/四种停止状态机，`src/game/game.test.ts:194-217` 的新测试也只针对这个类做单元测试；但 `src/GameApp.tsx` 实际运行时完全没有引入或使用这个类（只 `import { highestAllowedBet, LONG_PRESS_MS }`），真正跑在产品里的自动旋转逻辑是 `GameApp.tsx` 里另外手写的一套 `useState<number|null>` + `useEffect`。也就是说"新增测试覆盖自动旋转次数递减和四种停止条件"这条验收标准，测试覆盖的是一份没有被实际调用的平行实现，上面那条"旋转中能改投注"的真实 bug 完全没有被任何测试捕获。建议让 `GameApp.tsx` 直接复用 `AutoSpinController`（或者把状态机抽到一个可独立单测、又被 `GameApp.tsx` 真实调用的 hook 里），让测试真正覆盖线上逻辑。
- [轻微] `src/GameApp.tsx:256`（`onSpinHoldStart`）— 长按阈值判断 `if (!spinning && !inFreeSpins && credits >= bet) setAutoRemaining(50)` 没有排除"已经在自动旋转中"的情况。如果玩家在自动旋转的间隙（`spinning===false`）长按 SPIN/STOP 按钮超过 0.6 秒，会把 `autoRemaining` 重置为 50（而不是停止），同时因为 `heldSpin.current` 被置 `true`，`onClick` 里的 `onSpin()` 不会触发，相当于这次长按点击既没有停止自动旋转，也没有被当成正常点击处理。建议 `onSpinHoldStart` 里加上 `autoRemaining === null` 的判断。

## 给 Codex 的修改要求
1. 在 `src/GameApp.tsx` 把传给 `ControlBar` 的 `betLocked` 改成 `spinning || inFreeSpins || autoRemaining !== null`，确保自动旋转整个过程中（包括每局之间的间隙）投注 `−`/`+` 和 MAX 都保持禁用，直到自动旋转真正停止。
2. 让产品代码实际使用 `src/game/autoSpin.ts` 里已经写好并测试过的 `AutoSpinController`（或等价的、被 `GameApp.tsx` 真正调用的状态机），而不是在 `GameApp.tsx` 里维护一份不被测试覆盖的平行实现；之后补一条针对"自动旋转进行中不能改投注/按 MAX"的测试（可以是对该状态机 disabled 派生逻辑的单测）。
3. 顺手修一下 `onSpinHoldStart` 中长按逻辑，避免在自动旋转已激活时长按 SPIN/STOP 把剩余次数重置为 50。
4. 修完后重新跑 `npm test`、`npm run build`，并在 `docs/DEVLOG.md` 顶部补一条"第 2 次修正"记录。

VERDICT: FAIL
