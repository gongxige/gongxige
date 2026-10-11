# 审计报告：STEP-07 玩家钱包：充值、提现、资金记录（第 1 次）

- 时间：2026/10/11 11:10:51
- 审计的提交：b5dfe82（比较起点 STEP-06-passed）
- 结果：**通过**

---

## 结论
STEP-07 两条验收标准（超额提现被拒、冻结资金不可下注）均已满足并有对应测试覆盖；资金改动复用了早前步骤已验证的账本函数（原子 SQL 条件 + 同事务），范围未越界到 `src/engine/` 或流程文件，未收集任何真实收款信息，文档已按要求更新。判定为 PASS。

## 运行的检查
- `npm test` → 44/44 通过，含新测试「拒绝超出可用余额的提现，并且冻结金额不能下注」
- `npm run build` → 通过（tsc + vite build 无报错）
- `npm run check:provider` → 全部 7 项通过
- `git diff STEP-06-passed..HEAD` → 逐行人工核对

## 核查要点
- **提现超额拒绝**：`server/platform/ledger.mjs:108-122` `createWithdrawalRequest` 调用 `changeWallet`（`ledger.mjs:38-44`），SQL 条件 `balance + ? >= 0` 保证原子校验，超额时整笔操作在 `inTransaction` 内回滚，不留半笔记录；HTTP 层 `platform-server.mjs:175-181` 未捕获异常时交给最外层 catch（`platform-server.mjs:209-215`），`INSUFFICIENT_FUNDS` 落入默认 400，与新测试断言一致。
- **冻结资金不可下注**：提现冻结会把等额资金从 `balance` 转入 `frozen_balance`（同一事务、同一笔 ledger entry `withdrawal_freeze`），下注 `placeBet` 只扣 `balance`（`ledger.mjs:138-152`），不会动用 `frozen_balance`，因此冻结后可用余额不足时下注返回 `INSUFFICIENT_FUNDS` → 402，`platform-server.mjs:83-86` 做了该状态码映射。新测试（`src/platform/auth.test.ts` 新增用例）验证注册即得 10000 积分、提现 9980 冻结后余额剩 20、下注 21 被拒并返回 `402 INSUFFICIENT_FUNDS`。
- **会话与越权**：新增 `/api/wallet`、`/api/wallet/records`、`/api/deposit-requests`、`/api/withdrawal-requests` 均先 `currentPlayer(req)` 校验会话，`playerId` 全部取自会话而非客户端输入，不存在越权读取他人数据的路径。
- **不收集真实收款信息**：钱包页（`src/App.tsx` 的 `WalletPage`）只提交金额，明确标注“不收集银行卡、账户或任何真实收款信息”，`platform-server.mjs` 新路由也只处理 `amount`。
- **范围**：改动仅限 `platform-server.mjs`、`src/App.tsx`、`src/styles.css`、测试和文档；未触碰 `src/engine/`、`server/platform/ledger.mjs`（账本核心函数本就在更早步骤实现并已测试），没有跳做后续的后台审核页面（`approveWithdrawal` 存在但本步未接线，与 DEVLOG 的“遗留问题”一致）。
- **文档**：`docs/DEVELOPMENT_PLAN.md` 勾选新增一行，`docs/DEVLOG.md` 顶部新增本步记录，均符合要求。

## 问题
- [轻微] `platform-server.mjs:43-53` `walletRecords` 的 `UNION ALL` 查询没有 `LIMIT`，账号交易多了之后单次返回全部记录；仅是演示项目，不影响本步验收，可留给后续优化。

## 给 Codex 的修改要求
无（PASS，无需整改）。

VERDICT: PASS
