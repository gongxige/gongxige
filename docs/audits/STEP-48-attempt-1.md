# 审计报告：STEP-48 全面检查玉兔送财并修复 bug（第 1 次）

- 时间：2026/10/13 01:07:15
- 审计的提交：abe57ec（比较起点 STEP-47-passed）
- 结果：**不通过**

---

## 结论
服务器端的资金校验没有问题：mode/parentRoundId 校验、409 不扣款、旧版浏览器兼容、不再下发 replayInput 这几项都正确。自动旋转、模式接着转、立即停止、刷新续玩、回放和版面也都实测通过。但这一步在前端的提示文案上引入了一个回归问题：`if/else if` 链被插入的语句截断，导致「平台派彩稍有延迟」「恭喜触发 8 次财富旋转」「财富旋转结束 · 本轮共赢」这三条提示一律被后面的「赢得 X / 本局未中奖」覆盖，已在浏览器里实测确认。属于中等问题，本次不通过。

## 运行的检查
- `npm test` → 118/118 通过；`npm run build` → 通过。
- `git diff STEP-47-passed..HEAD` 逐个文件审阅。`src/rabbit/engine/index.ts` 只删了一行过时注释，没有改游戏规则，所以没有重跑 RTP。`src/engine/`（Wild Frontier）没有改动。
- 资金接口（roll=0，直接调用 8787）：
  - 旧版浏览器不带 `mode`：付费局正常扣款，8 次财富旋转都按免费局结算，和改动前行为一致。
  - 没有进行中的模式时发 `mode:'free'` → 409 `MODE_STATE_CHANGED`，余额不变。
  - 只带 `mode:'free'`、不带 parentRoundId → 正常结算。
  - 模式中发 `mode:'paid'` → 409，在扣款之前就返回。
  - 同时发 3 个财富旋转请求 → 1 个成功，2 个被 busy 拦下返回 409。
  - session 里只剩 `parentRoundId, bet, remaining, played, totalWin` 这几个字段。
- `platformcheck48.mjs` → 以下几种情况都返回 409 MODE_STATE_CHANGED：错误父局号、模式中的付费请求、模式结束后的重试。session 和回包都不含 modeStops。回放页：模式没打完时写「还没有全部转完」，转完后写「与已记录的各局相加一致」。
- 后台 `/api/admin/rounds` 和对应回放页（免费局、付费局各一局）→ 两局都显示「✓ 一致」，并显示「不足 5 个，不派彩」和中文盘面。后台列表里免费局显示为「免费局」。
- `bugcheck.mjs` 6 个场景：
  - lost-final：没有出现付费局，界面回到 idle，提示「玉兔模式已结束」。
  - auto-trigger：触发后 8 次财富旋转全部自动走完。这次运行时页面是带着进行中的模式（剩 7 次）打开的，自动续完，所以顺带验证了「刷新续玩」在不下发 replayInput 后仍然正常。
  - mode-board：检查 35 次，0 次不一致，其中 6 次是不足 5 个牌匾的局；模式中没有残留的中奖线；回到主游戏后赢分为 0。
  - auto-collect：自动旋转 5 次全部完成。
  - auto-error：共 2 次请求，第一次出错后自动旋转即停止。
  - stop-early：结果回来之前卷轴仍在转。
- 自写脚本记录提示文案的变化（roll=0 手动触发一轮完整模式；另一轮把回包改成 settlementPending=true）→ 发现下面那条中等问题。
- `layoutcheck.mjs`，有背景和无背景（临时改名素材目录，检查后已改回），尺寸 390×844、844×390、1366×768，每种都分普通和叠加层两次 → 提示文字都在视口内，按钮都在屏幕内，符号没有被裁，叠加层都铺满舞台。无背景 844×390 时卷轴底 281px、控制栏顶 296px，不重叠。有背景 844×390 是控制栏在右侧的布局，截图正常。
- 最后已用 restart.sh 不带第二个参数重启。`git status` 干净，素材目录已恢复。

## 问题
- [中等] src/rabbit/JadeRabbitApp.tsx:355-361 — 新加的 `if (result.triggered && autoRef.current > 0) {...}` 插在原来的 `else if` 链中间，把一条链拆成了两条。后果是 settlementPending、freeSpinsFinished、triggered（没开自动时）这三种提示，都会紧接着被 `else if (payout > 0)` 或 `else` 覆盖。实测：
  - 手动触发模式时提示变成「本局未中奖，再来一次」，没有「恭喜触发 8 次财富旋转！」。
  - 最后一次财富旋转显示「赢得 900」，不是「财富旋转结束 · 本轮共赢…（含触发局）」，要等 3 秒后 mode-total 的计时器才补上。所以第 16 条的文案只算部分生效。
  - 派彩延迟时提示是「赢得 80」，「平台派彩稍有延迟，赢分会自动到账。」完全不显示。这会误导玩家对余额到账的判断。
  - 修改前（STEP-47-passed:313-317）这是一条完整的链。
  - 改法：把停止自动的语句移出文案链，例如放到 `if (result.settlementPending)` 之前单独一行；文案部分恢复成 `if … else if … else if … else if … else` 的完整链。
- [轻微] src/rabbit/JadeRabbitApp.tsx:294 — 期待蓝光只在前两列「正好 4 个」牌匾时亮。前两列 2～3 个、最后一列补到 5 个的情况不会亮。这样确实不再提前暴露结果，但「可能凑满」的情况没有覆盖全，可以以后再定规则。
- [轻微] docs/JADE_RABBIT_BUGS.md / docs/DEVLOG.md — 第 17 条和第 18 条的②③在 DEVLOG 里没有单独写复现前后的结果。验收要求「修过的每条都有复现前后的检查结果」，建议补上。
- [轻微] 第 1 条的「回包丢失」路径回到主游戏后，不显示整轮共赢金额（modeTotalWin 拿不到），只提示「玉兔模式已结束」。不影响资金，可以考虑从玩家记录或 session 里补这个数。

## 给 Codex 的修改要求
1. 在 `src/rabbit/JadeRabbitApp.tsx` 的 spin 成功分支里恢复完整的提示文案链：
   - 先单独写一行 `if (result.triggered && autoRef.current > 0) { autoRef.current = 0; setAutoRemaining(null); }`，不接任何 else。
   - 然后写 `if (settlementPending) … else if (freeSpinsFinished) … else if (triggered) … else if (payout > 0) … else …`，最后保留 capped 的判断。
2. 补一个回归检查（浏览器脚本或截图）并写进 DEVLOG，确认以下三点：
   - 手动触发后提示是「恭喜触发 8 次财富旋转！」；
   - 最后一次财富旋转停下时提示是「财富旋转结束 · 本轮共赢 X（含触发局）」；
   - 回包 settlementPending=true 时提示是「平台派彩稍有延迟，赢分会自动到账。」。
3. 在 DEVLOG 里补上第 17 条和第 18 条②③的修复前后检查结果（截图或脚本输出）。
4. 重新运行 `npm test` 和 `npm run build`，更新 DEVLOG 中 STEP-48 的记录（第 2 次尝试）。

VERDICT: FAIL
