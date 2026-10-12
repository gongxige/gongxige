# 审计报告：STEP-42 玉兔送财中奖表现和玉兔模式画面（第 1 次）

- 时间：2026/10/12 16:48:39
- 审计的提交：af1608e（比较起点 STEP-41-passed）
- 结果：**不通过**

---

## 结论
`npm test`（107/107）和 `npm run build` 都能跑通，但 STEP-42 的两条关键验收点没有真正做到：吉祥物缺少设计文档要求的"模式触发/大奖"专属动作，且新增的展示状态机可以被正常操作（点击旋转/长按空格）打断、并因为一处没有清理的 `setTimeout` 而在之后错乱地把已经过时的"触发"画面叠加回已经开始的财富旋转画面之上，导致画面顺序与服务器记录不再一致。判定为 FAIL。

## 运行的检查
- `npm test` → 通过，107/107
- `npm run build` → 通过（`tsc -b && vite build` 无报错）
- `git diff STEP-41-passed..HEAD` 逐行阅读 `src/rabbit/JadeRabbitApp.tsx`、`src/styles.css`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`
- 对照 `docs/WORKFLOW_PLAN.md` STEP-42 条目和 `docs/JADE_RABBIT_DESIGN.md` 第 10.3/10.4 节核对展示状态是否与服务器字段（`triggered`、`bonusWins`、`modeIndex`、`freeSpins`、`freeSpinsFinished`）一致
- 阅读 `server.mjs` 的 `handleRabbitSpin`，确认触发时服务器已经一次性把 `freeSpins:{remaining:8,...}` 带在那次付费旋转的响应里返回

## 问题
- [中等] `src/rabbit/JadeRabbitApp.tsx:253-262` — 5 个以上奖金牌且同局触发模式时，用裸的 `window.setTimeout(..., 1_850)` 把展示状态从 `bonus-collect` 切到 `mode-trigger`，这个定时器既没有存引用也没有在任何 `useEffect` 里清理。由于 `spin()`（旋转按钮）和空格键处理都没有检查 `presentation`，玩家在这 1.85s～4.15s 的触发/开场窗口内点旋转或按住空格（本来就是支持的连发操作）会立刻发起下一次财富旋转请求，画面状态机被新结果覆盖；但那个过期的 `setTimeout` 之后仍会触发，把 `presentation` 强制改回 `mode-trigger`，于是财富旋转已经开始之后，屏幕又跳回"触发"画面——与服务器实际记录的事件顺序不一致，违反该步骤"动画按服务器返回的结果播放""每段画面与服务器记录一致"的验收要求。应改为：旋转/空格的触发条件里加入对 `presentation` 的判断（展示性的叠加画面播放期间不接受新的旋转请求，或至少不提前发起下一次调用），同时把这个 `setTimeout` 收进 `useEffect` 并在依赖变化/卸载时 `clearTimeout`。
- [中等] `src/rabbit/JadeRabbitApp.tsx:64-78`、`src/styles.css:377` — 任务要求和 `JADE_RABBIT_DESIGN.md` §10.4 第 6 条都明确写了吉祥物至少要有"待机、线中奖、模式触发、大奖"四个**不同**动作（模式触发要"跃起"，结束大奖要"旋转落地、张开云尾庆祝"），但这次没有新增任何吉祥物动作：`mode-trigger`、`mode-intro`、`mode-collect`、`mode-finale`、`mode-total` 全部复用同一个在 STEP-41 之前就存在的 `rabbit-mascot-mode`（`rabbit-hop .7s` 慢速弹跳），触发瞬间和终局大奖在吉祥物身上看起来完全一样，没有做出设计要求的区分动作。
- [轻微] `src/rabbit/JadeRabbitApp.tsx:328-332` — 付费旋转触发模式后，`presentation` 回到 `mode-spin` 等待第一次财富旋转请求发出前的 720～1450ms 内，`displayBoard` 没有被置空（只有 `mode-intro`/`mode-finale`/`mode-total` 会强制清空），红色模式背景下会短暂露出上一次付费旋转的主游戏符号，和设计"进行中只显示红底结纹 BLANK 或奖金牌匾"略有出入；影响观感，不影响数据正确性。

## 给 Codex 的修改要求
1. 给 `spin()` 和空格键处理增加对展示状态的判断：当 `presentation` 处于 `bonus-collect`/`mode-trigger`/`mode-intro`/`mode-collect`/`mode-finale`/`mode-total` 这类"叠加画面播放中"的状态时，不接受新的旋转请求（按钮可禁用或直接 return），避免玩家手动操作抢在服务器已记录的展示顺序之前。
2. 把 `src/rabbit/JadeRabbitApp.tsx:255` 那个裸的 `window.setTimeout` 改写成受 `useEffect` 管理、能在依赖变化或组件卸载时 `clearTimeout` 的形式（可以参考已有的 `mode-trigger`/`mode-collect` 的 `useEffect` 写法），消除"旧回调把已经推进的展示状态强制改回去"的可能性。
3. 为吉祥物新增至少两个新的、视觉上能区分的动作类：模式触发时的"跃起"动作，以及大奖结束时的"旋转落地、张开云尾庆祝"动作，分别只在 `mode-trigger` 和 `mode-finale`（或 `mode-total`）下使用，不再与 `mode-intro`/`mode-collect` 共用同一个弹跳动画。
4. （建议顺带处理）在等待第一次财富旋转请求发出的 `mode-spin` 过渡期也把 `displayBoard` 置空，避免短暂露出主游戏盘面。
5. 修完后重新跑 `npm test`、`npm run build`，并在 DEVLOG 里补充这次怎么验证"展示顺序不会被手动操作打断"（例如写一段说明或简单的交互测试）。

VERDICT: FAIL
