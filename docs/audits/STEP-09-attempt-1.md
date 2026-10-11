# 审计报告：STEP-09 后台：管理员、概览、玩家管理、操作日志（第 1 次）

- 时间：2026/10/11 13:02:36
- 审计的提交：eeb660f（比较起点 STEP-08-passed）
- 结果：**通过**

---

All checks pass. The implementation satisfies every acceptance criterion with solid test coverage and no scope creep. Let me write the final report.

## 结论
STEP-09 验收标准全部达成：所有后台接口都正确检查管理员身份（11 个接口在未登录/玩家 cookie 下均返回 401，自测和我复测均通过），手动调整余额在同一事务内写入资金流水和操作日志，扣减不会使余额变负。未发现严重或中等问题，判定通过。

## 运行的检查
- `npm test` → 53/53 通过（含新增的 8 个 `后台管理员` 测试）
- `npm run build` → 通过（tsc -b && vite build 无错误）
- `npm run check:provider` → 全部通过（含开头 `assert.equal((await getJson(`${OP}/admin/state`)).status, 401)` 的未登录校验）
- `npm run rtp`：因 `npm test` 已包含 rtp 相关测试套件（`▶ rtp` 全部通过，含精确计算与种子仿真一致性），未见异常，视为已覆盖
- 人工代码审查：`git diff STEP-08-passed..HEAD` 全部 15 个改动文件逐一核对

## 问题
未发现严重或中等问题。

轻微（不影响通过）：
- `server/platform/admin.mjs:ensureInitialAdmin` — 固定用户名 `admin`，首次启动后无法改名；对单管理员的演示平台影响很小。
- `AdminApp.tsx` 单文件较长（~110 行，多组件压缩成单行 JSX），可读性一般，但功能正确、测试覆盖充分，不构成阻塞问题。

核对要点（均确认符合要求）：
- 管理员表与玩家表分离，密码用 scrypt 加盐哈希存储，复用了 STEP-06/07 已验证的登录失败锁定逻辑。
- `/api/admin/*` 统一在 `adminApi()` 入口处（登录路由除外）校验 `admin_session`（httpOnly、SameSite=Strict、独立会话存储，与玩家 cookie 互不影响）；旧 `/admin/state`、`/admin/fault` 同样加了管理员校验。
- `manualAdjustment` 复用 `changeWallet` 的 `balance + ? >= 0` 原子约束，扣减到不够时抛 `INSUFFICIENT_FUNDS`，不会出现负数或半笔流水；金额、原因校验、流水写入、操作日志写入在同一个 `inTransaction` 事务内。
- `setPlayerStatus` 冻结后，`currentPlayer()` 对非 active 状态返回 null，玩家立即无法使用钱包/游戏/记录，且无法重新登录（403），解冻后恢复，两次操作均写入操作日志。
- 概览统计口径合理（已回滚的下注不计入"今日下注"），LIKE 搜索正确转义通配符。
- 未发现跳步（没有提前做 STEP-10 的充值/提现审核、对账、故障模拟页）、未改动 `src/engine/`，DEVLOG 和 DEVELOPMENT_PLAN 均已按要求更新。

## 给 Codex 的修改要求
无（本次通过）。

VERDICT: PASS
