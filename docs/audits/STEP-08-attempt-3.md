# 审计报告：STEP-08 玩家：游戏记录、个人中心（第 3 次）

- 时间：2026/10/11 12:48:42
- 审计的提交：6bf9521（比较起点 STEP-07-passed）
- 结果：**通过**

---

## 结论
STEP-08 第 3 次已经把第 2 次审计指出的 `check:provider` 回归修好了：局号/回放查询改成带签名的 `POST /provider/rounds`，仍然保持"只能查自己的局"的边界（按 `operatorId` + `playerId` 双重过滤），`scripts/provider-check.mjs`、`mock-operator.mjs`、`docs/PROVIDER_API.md` 都同步更新，且新增了"别的玩家 404 / 错签名 401 / 旧公开接口 404"的断言。实测 `npm run build`、`npm test`（45/45）、`npm run check:provider` 全部通过。本次没有改动 `src/engine/`、`server/platform/`（账本/认证逻辑），范围合适。判定为 **PASS**。

## 运行的检查
- `git log STEP-07-passed..HEAD --oneline` → 确认本次比较范围含 STEP-08 三次尝试的全部提交
- `git diff STEP-07-passed..HEAD`（全部改动文件逐一核对，含 `server.mjs`、`scripts/provider-check.mjs`、`mock-operator.mjs`、`platform-server.mjs`、`vite.config.ts`、`docs/PROVIDER_API.md`、`src/App.tsx`、`src/platform/auth.test.ts`、`src/styles.css`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`、`scripts/autopilot.mjs` 等）
- `git diff STEP-07-passed..HEAD --stat -- src/engine/ server/platform/` → 无输出，确认引擎与账本代码未被改动
- `npm run build` → 通过（`tsc -b && vite build`）
- `npm test` → 45/45 通过，含新测试「游戏记录和回放只允许当前玩家读取，且可以修改密码」
- `npm run check:provider` → 全部 7 项检查通过，包括新增的"别的玩家 404、错误签名 401、旧 `GET /api/rounds/{id}` 已 404"断言
- 阅读 `server/rounds.mjs`、`server/replay-page.mjs`、`platform-server.mjs` 的 `currentPlayer`/`providerRounds` 逻辑，确认玩家侧的 `playerId` 来自已登录会话而非用户输入，供应商侧用 `operatorId + playerId` 双重过滤，不存在越权查询路径
- 检查 `vite.config.ts` 代理表顺序（`/api/wallet`、`/api/deposit-requests`、`/api/withdrawal-requests`、`/api/game-records` 在通用 `/api` 之前），结合 Node 对象属性保序特性确认具体路径会先于通用规则匹配
- 尝试用隔离端口手工启动完整开发栈并经 Vite（4173 对应端口）发真实 HTTP 请求复现浏览器路径：该操作被本次审计沙箱权限拒绝（与前几次审计记录的限制一致），只能依赖上面的自动化测试（`auth.test.ts` 直接起 `server.mjs`+`platform-server.mjs` 两个真实进程互相签名调用）和 `check:provider`、静态代码追踪来印证

## 问题
- [轻微] `docs/CLOUD_DEPLOY_TASK.md:71` — 仍写着"游戏服务器的 `/api/rounds/*`、`/api/replay/*` 在生产环境也要保护"，但这两个公开接口本次已经删除，这条上云清单项已经不适用。Codex 在 DEVLOG 里已如实记录为遗留问题，不影响本步功能，建议后续上云步骤顺手删掉或改写这一条。

## 给 Codex 的修改要求
无需返工。建议在后续处理 `docs/CLOUD_DEPLOY_TASK.md` 的步骤中，顺手删除/改写第 71 行里对已不存在的 `GET /api/rounds/*`、`GET /api/replay/*` 的保护说明。

VERDICT: PASS
