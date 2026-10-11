# 审计报告：STEP-10 后台：审核、流水、游戏记录、对账、故障模拟（第 1 次）

- 时间：2026/10/11 13:15:28
- 审计的提交：f0a4ef2（比较起点 STEP-09-passed）
- 结果：**通过**

---

## 结论
STEP-10（第 1 次）通过。验收标准全部达到：同一申请不能被审核两次（含并发），对账页数字与资金流水一致；范围未越界，未动 `src/engine/`；资金正确性、权限检查、演示边界均无问题。

## 运行的检查
- `git diff STEP-09-passed..HEAD --stat` → 只改了 docs、`platform-server.mjs`、`server.mjs`、`server/platform/{admin,ledger}.mjs`、`src/admin/AdminApp.tsx`、`src/platform/admin-review.test.ts`、`src/styles.css`，`src/engine/` 无改动
- `npm test` → 61/61 通过（含新增 8 个 STEP-10 测试：401 防护、充值审核+重复 409、10 并发审核同一充值只成功 1 个、提现拒绝退冻结+10 并发通过只扣一次、流水筛选、游戏记录+回放一致、对账一致性+改库造差额后 `ok:false` 差额 123、故障模拟+日志）
- `npm run build` → 通过（tsc -b && vite build）
- `npm run check:provider` → 全部通过（含 `scope: operator` 相关场景间接验证签名与归属不变）

## 代码核查要点
- `settleRequest`（`server/platform/ledger.mjs`）用 `UPDATE … WHERE id = ? AND status = 'pending'`，`changes !== 1` 即抛 `REQUEST_NOT_PENDING`（映射 409），且整段在 `inTransaction`（`BEGIN IMMEDIATE`，Node 同步 SQLite，单线程无 `await` 穿插）里执行，天然串行化，并发测试也验证了这一点。
- 提现拒绝正确把冻结退回可用（`balanceDelta:+amount, frozenDelta:-amount`），充值拒绝不动钱；`changeWallet` 的 `WHERE balance + ? >= 0 AND frozen_balance + ? >= 0` 防止任何路径把余额/冻结打成负数。
- 新增的 12 个 `/api/admin/*` 路由都在 `adminApi()` 里经过同一个 `admin` 会话检查（401 测试覆盖未登录和玩家 cookie 两种情况）；旧 `/admin/fault`、`/admin/state` 维持原有的会话检查不变。
- `operatorRounds`（`scope: 'operator'`）仍强制走签名校验，`ownsRound` 仍以 `operatorId` 限定，不会跨平台泄露；不带 `scope` 时玩家侧查询行为不变。
- 对账 `reconcilePlayer`/`reconciliation` 的计算口径和前端表格、测试里逐条流水相加的口径一致。
- 全程仍是虚拟 DEMO 积分，没有接入真实支付/银行/加密货币或收款信息。

## 问题
无（severity: 无严重/中等问题；未发现需要记录的轻微问题）。

## 给 Codex 的修改要求
无需修改。

VERDICT: PASS
