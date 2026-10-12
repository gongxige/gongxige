# 审计报告：STEP-35 麻将免费旋转自动进行（第 1 次）

- 时间：2026/10/12 12:22:27
- 审计的提交：e811111（比较起点 STEP-34-passed）
- 结果：**通过**

---

## 结论
STEP-35 的实现（`src/mahjong/MahjongApp.tsx` 新增 effect）逻辑正确、改动范围克制，满足验收标准；`npm run build`、`npm test` 均通过。有一处文档归类的轻微问题，不影响通过。

## 运行的检查
- `git diff STEP-34-passed..HEAD --stat` → 只改了 `src/mahjong/MahjongApp.tsx`（功能代码）+ 5 个文档/状态文件，`src/engine/` 未被触碰。
- `npm run build` → 成功（tsc -b && vite build，无报错）。
- `npm test` → 93/93 通过（含麻将引擎、免费旋转、回放、后台等全部套件）。
- 代码审读 `MahjongApp.tsx` 新 effect（第 145-150 行）及其与 `spin()`、`busy`、`overlay`、`inFree`、`freeSpins` 的交互：
  - 效果依赖 `[inFree, freeSpins, overlay, rules, error, tick]`，每次 `spin()` 开始/结束都会 `force` 触发重跑；`busy.current` 为真或有 `overlay`/`rules`/`error` 时直接返回，不会在动画、全屏画面、规则页、阻断错误期间抢跑。
  - 手动点击与自动定时器会互相取消（`clearTimeout` 在 effect 清理函数里），不会出现同一时刻两次 `spin()` 并发。
  - 免费旋转最后一局 `freeSpinsFinished` 返回后 `setFreeSpins(result.freeSpins)`（应为 `null`），`inFree` 变为 `false`，effect 不再调度下一次 —— 不会自动扣付费局，按钮状态随 `inFree` 回到"旋转"。
  - 刷新页面：挂载时的 session 请求把服务器返回的未完成 `freeSpins` 写入状态，`inFree` 变真即触发同一个 effect，自动继续，符合要求。
  - 延时常量按"上一局是否中奖"（`lastWin.current`）区分 1.5s / 0.7s，时序上在停轴动画、连锁动画、`overlay`（获得/追加/结束画面）全部播放完之后才开始计时，不会错过展示。
- 未能在本次审计环境中实际跑无头浏览器复现"连续免费旋转自动转完"的点击级验证：`chromium-cli` 在审计员的权限范围内被拒绝执行（审计规则只允许 git 只读命令和 `npm test`/`npm run build`/`npm run check:provider` 等检查命令，没有授权启动服务器或浏览器自动化）。以上结论基于对该 effect 与 `spin()` 全部状态机分支的逐条走读，逻辑自洽，且与现有 93 个自动化测试（含麻将引擎、免费旋转记录、回放等）并不冲突。

## 问题
- [轻微] docs/DEVELOPMENT_PLAN.md:145 — STEP-35（麻将免费旋转自动进行）被加在"阶段 8：游戏打磨（照参考游戏做好 Wild Frontier）"小节里，紧跟在 Wild Frontier 的 STEP-22 后面；但 STEP-35 是麻将连连胡的功能，应该归入"阶段 9：第二款游戏「麻将连连胡」"或"阶段 10：麻将连连胡数学第 2 版"小节，和 STEP-23~34 放在一起，避免以后看计划时误以为改了 Wild Frontier。
- [轻微] src/mahjong/MahjongApp.tsx:146-150 — 免费旋转自动调用 `spin()` 失败（比如网络错误）时只更新 `message`，不会把 `error` 置真，effect 的 catch 分支结束后 `busy.current=false` 会立刻重新调度下一次自动旋转；如果后端持续报错，会变成每 0.7~1.5 秒自动重试一次，直到成功或玩家离开页面。不是本步验收要求覆盖的场景，但可以考虑在连续失败时加个退避或提示，不强制本次修改。

## 给 Codex 的修改要求
无需修改即可通过；如果顺手处理，建议：
1. 把 docs/DEVELOPMENT_PLAN.md 里 STEP-35 那一行移到"阶段 9"或"阶段 10"小节下，而不是留在 Wild Frontier 的"阶段 8"里。

VERDICT: PASS
