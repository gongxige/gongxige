# 审计报告：STEP-42 玉兔送财中奖表现和玉兔模式画面（第 2 次）

- 时间：2026/10/12 16:54:21
- 审计的提交：8f18e42（比较起点 STEP-41-passed）
- 结果：**不通过**

---

## 结论
`npm test`（107/107）和 `npm run build` 都能跑通，第 1 次审计提出的三个问题（展示期间可被打断、裸 `setTimeout` 未清理、吉祥物缺少触发/大奖专属动作）在代码层面都已改写。但这次改写在 `mode-trigger` 展示状态的 `useEffect` 里引入了一个新的、更严重的回归：触发玉兔模式后画面会永久卡在"8 次财富旋转"开场画面，再也无法进入实际的财富旋转，因为负责把画面推进到 `mode-spin` 的定时器会在推进到 `mode-intro` 的瞬间被同一个 effect 的清理函数取消掉，而旋转按钮/空格键又被这次新加的展示锁挡住，玩家没有任何办法脱困。这直接破坏了本步骤的核心验收点（"按服务器结果播放完整的玉兔模式流程"），判定为 **FAIL**。

## 运行的检查
- `npm test` → 通过，107/107
- `npm run build` → 通过（`tsc -b && vite build` 无报错）
- `git diff STEP-41-passed..HEAD` 逐行阅读 `src/rabbit/JadeRabbitApp.tsx`、`src/styles.css`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`
- 对照 `docs/audits/STEP-42-attempt-1.md` 逐条核对第 1 次审计的三个问题是否被修复
- 手动按 React `useEffect` 依赖/清理语义逐步模拟 `presentation` 状态机的时间线（0ms → 900ms → 2300ms），确认 `mode-intro` 之后是否真能自动走到 `mode-spin`
- `grep modeIndex`，确认 `server.mjs` 确实在响应里返回该字段，前端读取方式与服务器字段匹配

## 问题
- [严重] `src/rabbit/JadeRabbitApp.tsx:206-211` — 这个 effect 在 `presentation === 'mode-trigger'` 时一次性设置了两个定时器：900ms 后 `setPresentation('mode-intro')`，2300ms 后 `setPresentation('mode-spin')`。但 900ms 的回调一执行，`presentation` 变化会让 React 对**这同一个 effect**先跑清理函数（`clearTimeout(introTimer); clearTimeout(spinTimer);`），此时 2300ms 的 `spinTimer` 还没到点，会被直接取消；随后这个 effect 以新的 `presentation`（`mode-intro`）重新求值，第一行 `if (presentation !== 'mode-trigger') return;` 立即返回，不会重新挂一个定时器去完成 `mode-intro → mode-spin` 的推进。结果是：只要玉兔模式被触发，画面会卡死在"8 次财富旋转"开场画面，永远不会显示真正的财富旋转盘面。而本次为修复第 1 次审计意见新加的展示锁（`spin()` 和空格键在 `presentation` 为 `mode-intro` 等状态时直接 `return`，见 `JadeRabbitApp.tsx:241`、`JadeRabbitApp.tsx:317`）又堵死了玩家用手动旋转"绕过"这个卡死状态的可能，整局游戏在触发模式后无法再继续，与"动画按服务器返回的结果播放""每段画面与服务器记录一致"的验收要求直接冲突，属于阻断性 bug。
  - 核对了全文件里所有 `setPresentation(...)` 调用（`JadeRabbitApp.tsx:181,202,208,209,215,219,267,269,271,273`），确认没有任何其它代码路径能把 `presentation` 从 `mode-intro` 带回 `mode-spin`，上述分析不是孤立场景。
- [轻微] `docs/DEVLOG.md`（第 2 次尝试条目）写"核对展示锁会让按钮与空格键在整段叠加动画期间直接返回"，但没有提到对 `mode-trigger → mode-intro → mode-spin` 这条自动推进链路做过任何实际验证（哪怕是手动走一遍时间线），而这正是本次新引入 bug 所在之处；只写"运行了 npm test / npm run build"不足以证明画面顺序正确，与 AUDITOR 清单第 1 条"亲自运行命令、以实际结果为准"的精神相悖（这条本身不构成 FAIL 的理由，但说明验证方式需要加强）。

## 给 Codex 的修改要求
1. 把 `src/rabbit/JadeRabbitApp.tsx:206-211` 的 `mode-trigger` effect 拆成两段独立推进，不要在同一个 effect 里排两个会互相踩踏的定时器。推荐写法：保留一个 effect 只负责 `mode-trigger → mode-intro`（900ms），再单独增加一个以 `presentation === 'mode-intro'` 为依赖的 effect 负责 `mode-intro → mode-spin`（经过它自己的 1400ms 左右停留时间，而不是从 `mode-trigger` 算起的 2300ms），和现有 `mode-collect`/`mode-finale` 的写法保持一致（每个 effect 只在自己对应的状态下设一个定时器、清理自己的定时器）。
2. 修完后用脚本或手动方式实际走一遍"触发模式"的时间线（例如在浏览器里触发一次模式，或写一段验证说明），确认能看到画面从触发 → 开场 → 第一次财富旋转盘面自动推进，不会卡在开场画面；在 DEVLOG 里写清楚具体怎么核对的。
3. 重新跑 `npm test`、`npm run build`，确认仍然通过。

VERDICT: FAIL
