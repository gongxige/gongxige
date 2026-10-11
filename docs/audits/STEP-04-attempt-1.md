# 审计报告：STEP-04 平台服务接管钱包接口（第 1 次）

- 时间：2026/10/11 08:09:12
- 审计的提交：56c7d21（比较起点 STEP-03-passed）
- 结果：**通过**

---

## 结论
STEP-04 验收标准全部达到：新平台服务在 8788 端口以 STEP-03 账本实现了签名钱包接口、交易去重、回滚作废，行为与 `mock-operator.mjs` 一致；`npm start`、`check:provider` 已切换；本步骤改动范围干净，未涉及 `src/engine/`、`server.mjs`、`package.json`。判定 **PASS**。

## 运行的检查
- `npm test` → 39/39 通过（含新增的「回滚退回原扣款，并作废迟到的扣款交易号」用例）。
- `npm run check:provider` → 全部 7 项检查通过：签名/伪造拒绝、交易去重与回滚、10 局真实旋转对账、回放一致性、派彩连续故障自动补发、扣款超时自动回滚、余额不足拒绝。
- `git diff STEP-03-passed..HEAD -- package.json server.mjs src/engine` → 无改动，确认未跳步、未动引擎或无关文件。
- `git status --short` → 工作区干净，与会话开始时的 git 状态一致。

## 代码审查要点（均通过）
- `server/platform/ledger.mjs` 新增的 `refundBet`：以 `provider_transactions.transaction_id` 做回滚自身的幂等键；对已完成的原扣款执行 `changeWallet(+amount, 0)` 并将其状态置为 `refunded`/`cancelled`；对尚未到达的原扣款插入占位的 `cancelled` 记录，使迟到的 `placeBet` 命中幂等分支直接返回而不会真正扣款——与 `mock-operator.mjs` 原逻辑语义一致，且在同一个 `inTransaction` 事务内完成余额变更和流水记录。
- `platform-server.mjs` 的故障注入（`win-down`/`slow-bet`）、签名校验（`x-operator-id` + `verify`）、幂等/取消状态检查顺序，与旧 `mock-operator.mjs` 逐项对照后行为一致（包括 fault 检查先于 win 幂等判断、slow-bet 对重试交易的延迟处理）。
- `/wallet/*` 全部路径（含 `balance`）都先做签名校验，未削弱原有安全边界；`/admin/*` 无鉴权与原文件保持一致（仅本机 127.0.0.1 演示用途），非本步骤引入的新风险。
- `scripts/provider-check.mjs`、`scripts/start.mjs` 的改动只是切换到新服务及调整测试超时/端口分配，未改变被测行为的边界条件。
- `docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`、`docs/workflow/state.json` 均已正确更新。

## 问题
无严重或中等问题。轻微建议：`SLOW_MS` 的默认值和 `check:provider` 里覆写的 `SLOW_BET_MS` 都只是时间参数调整，不影响正确性，无需改动。

VERDICT: PASS
