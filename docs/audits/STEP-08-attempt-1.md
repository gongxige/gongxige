# 审计报告：STEP-08 玩家：游戏记录、个人中心（第 1 次）

- 时间：2026/10/11 11:22:30
- 审计的提交：ca2369d（比较起点 STEP-07-passed）
- 结果：**不通过**

---

## 结论
STEP-08 的"游戏记录"功能存在一个会导致真实玩家在浏览器里完全无法使用的路由错配问题：新增的 `/api/game-records`、`/api/game-records/:id/replay` 只挂在 `platform-server.mjs`（8788 端口），但 `vite.config.ts` 把所有 `/api/*` 请求代理到游戏引擎服务 `server.mjs`（8787 端口），该服务没有这两个路径，会返回 404。自动化测试之所以全部通过，是因为测试直接对 `platform-server.mjs` 自己的端口发请求，绕开了网页实际使用的 Vite 代理，没能覆盖这条路径。这意味着玩家在网页里点"游戏记录"大概率会看到加载失败，点局号打开回放也会 404——这是本步骤明确要交付的核心功能之一，判定为 **FAIL**。"个人中心"改密页面调用的是 `/auth/password`（代理配置正确指向 8788），静态审读未发现问题。

## 运行的检查
- `npm test` → 45/45 通过（含新测试「游戏记录和回放只允许当前玩家读取，且可以修改密码」）
- `npm run build` → 通过（`tsc -b && vite build`）
- `git diff STEP-07-passed..HEAD` → 逐行人工核对
- 尝试以隔离端口手工启动完整开发栈（`node scripts/start.mjs` + `curl`）复现浏览器真实调用链路：该操作被本次审计沙箱权限拒绝（与 STEP-06/STEP-07 审计报告中记录的限制一致），因此以静态代码追踪为依据

## 问题
- [严重] `vite.config.ts:12` 与 `platform-server.mjs:199-214` — `/api` 代理固定指向游戏引擎端口（`apiPort`，默认 8787 的 `server.mjs`），但本步新增的 `GET /api/game-records` 和 `GET /api/game-records/:id/replay` 只在平台服务（`platform-server.mjs`，8788）上注册。`server.mjs`（见 `server.mjs:264-281`）没有这两条路由，命中末尾的通用 `json(res, 404, { error: 'Not found' })`。玩家在网页里点击大厅的"游戏记录"（`src/App.tsx:57` 的 `GameRecordsPage` 调用 `platformFetch('/api/game-records')`，相对路径经 Vite 代理解析）会被错误转发到 8787 端口并收到 404，页面只能显示错误提示，无法看到任何记录；局号回放链接 `src/App.tsx:59`（`/api/game-records/{roundId}/replay`）同理会 404。单元测试（`src/platform/auth.test.ts`）是直接对 `platform-server.mjs` 自己监听的端口发请求，完全没有经过 Vite 代理，因此没能暴露这个问题。
  - 补充说明：这是同一个历史遗留的代理配置缺陷，STEP-07 新增的 `/api/wallet`、`/api/wallet/records`、`/api/deposit-requests`、`/api/withdrawal-requests` 其实也受影响（该步已通过，不在本次判定范围内，但建议一并修复，因为是同一根因）。

## 给 Codex 的修改要求
1. 修复 `vite.config.ts` 的代理规则，让归属平台服务（8788/`OPERATOR_PORT`）的 `/api/*` 路径（`/api/wallet`、`/api/wallet/records`、`/api/deposit-requests`、`/api/withdrawal-requests`、`/api/game-records`、`/api/game-records/:id/replay`）正确代理到平台服务，而不是游戏引擎服务（8787/`API_PORT`）。可选思路：把游戏引擎的 `/api/health`、`/api/config`、`/api/session`、`/api/spin` 几条路径改成更具体的代理匹配（如显式列出这几条路径代理到 `apiPort`，其余 `/api/*` 代理到 `OPERATOR_PORT`），或者把平台这几条路由改到不与引擎冲突的前缀（如 `/platform/api/...`）并同步调整前端调用路径。两者选一种，保持改动最小、逻辑清晰即可。
2. 修复后请用实际浏览器（或至少用 curl 经过 `http://127.0.0.1:4173/api/game-records` 这条路径，而不是直接打平台端口）验证：登录后能看到仅属于自己的游戏记录列表，点击局号能打开回放页且内容正确；同时回归验证钱包页（我的钱包/资金记录/充值/提现）在浏览器路径下同样可用，因为是同一个代理配置改动。
3. 其余部分（记录归属过滤、回放代理的签名与越权校验、改密流程、文档更新）本次审读未发现问题，无需改动。

VERDICT: FAIL
