# 审计报告：STEP-11 端到端检查和收尾（第 1 次）

- 时间：2026/10/11 13:23:58
- 审计的提交：216b31e（比较起点 STEP-10-passed）
- 结果：**通过**

---

## 结论
STEP-11（端到端检查和收尾）验收标准全部达到：`npm run build`、`npm test`、`npm run check:provider`、新增的 `npm run check:platform` 全部通过（后者连跑两次均通过）；改动范围只限于脚本、`package.json`、README 和文档，未涉及 `src/engine/` 或已有流程文件；README 对照代码核实准确。判定 PASS。

## 运行的检查
- `git diff STEP-10-passed..HEAD --stat` → 只改了 README.md、docs/DEVELOPMENT_PLAN.md、docs/DEVLOG.md、docs/workflow/state.json、package.json、scripts/admin-password.mjs（新）、scripts/platform-check.mjs（新）、scripts/start.mjs
- `npm run build` → 通过（tsc -b + vite build 成功）
- `npm test` → 61/61 通过
- `npm run check:provider` → 通过
- `npm run check:platform` → 通过（连续运行两次，端口/临时数据互不干扰）
- 读 `scripts/platform-check.mjs` 全文，核对其覆盖了验收标准要求的全部场景：注册→充值申请→后台通过→玩 50 局→提现申请→后台通过→对账一致、余额不足不能提现、冻结金额不能下注、同一提现不能通过两次（含并发 3 次只成功 1 次）、同时 20 次下注不会扣成负数（余额 500、每笔 80，验证恰好成功 6 笔且不为负）
- 读 `scripts/start.mjs`、`platform-server.mjs` 中 `首次启动：…初始密码` 的打印文案，核对与 README 和 `start.mjs` 里"[平台] 首次启动"的引用一致
- 读 `scripts/admin-password.mjs` 及其依赖的 `ensureInitialAdmin`/`hashPassword` 实现，确认无论管理员是否已存在，最终都能把 `admin` 密码设置为新生成的随机密码（见下方问题里的一个轻微点）
- 读 README.md 全文改动，核对运行方式、端口、数据位置、检查命令、目录结构描述与代码/package.json 实际一致

## 问题
- [轻微] scripts/admin-password.mjs:16 — 当还没有任何管理员时，`ensureInitialAdmin(db, { password })` 会用传入的 `password` 创建账号，但因为显式传了 `password`，函数内 `generated` 恒为 `null`，返回值也恒为 `null`；于是脚本的 `if (!await ensureInitialAdmin(...))` 分支在"刚创建"和"已存在"两种情况下都会执行，对刚创建的账号又做一次多余的 `UPDATE`（重新哈希一次同一个密码）。结果仍然正确（密码确实是打印出来的那个），只是多算了一次哈希，不影响功能，不要求本次必须改。

## 给 Codex 的修改要求
无（PASS，不要求本次修改；上面的轻微点可以留到以后顺手改，不影响通过）。

VERDICT: PASS
