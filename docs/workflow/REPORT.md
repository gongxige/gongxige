# 自动开发运行报告

> 2026-10-11 07:43 开始，13:24 结束。写报告的是 Claude Code。

## 一句话结论

**11 步全部完成，剩 0 步。** 每一步都通过了独立的 Claude Code 审计，并打上了 `STEP-01-passed` ~ `STEP-11-passed` 标签。最后一次检查：`npm run build` 通过，`npm test` 61/61 通过，`npm run check:provider` 和新增的 `npm run check:platform` 全部通过。

## 每一步是谁做的

| 步骤 | 内容 | 谁写的 | 审计 |
|---|---|---|---|
| STEP-01 | 阶段 6 收尾 | Codex | 第 5 次通过（前 4 次是 Codex 环境坏了，见下面问题 1） |
| STEP-02 | 平台设计文档 | Codex | 第 1 次通过 |
| STEP-03 | 平台数据库和记账核心 | Codex | 第 1 次通过 |
| STEP-04 | 平台服务接管钱包接口 | Codex | 第 1 次通过 |
| STEP-05 | 玩家注册、登录（接口） | Codex | 第 1 次通过 |
| STEP-06 | 玩家网站：注册、登录、大厅、进入游戏 | Codex | 第 2 次通过 |
| STEP-07 | 玩家钱包：充值、提现、资金记录 | Codex | 第 1 次通过 |
| STEP-08 | 玩家：游戏记录、个人中心 | Codex 写了 2 次，第 3 次由 Claude Code 修好 | 第 3 次通过 |
| STEP-09 | 后台：管理员、概览、玩家管理、操作日志 | Claude Code | 第 1 次通过 |
| STEP-10 | 后台：审核、流水、游戏记录、对账、故障模拟 | Claude Code | 第 1 次通过 |
| STEP-11 | 端到端检查和收尾 | Claude Code | 第 1 次通过 |

STEP-09 ~ STEP-11 是你中途同意"剩下的由 Claude Code 自己开发"之后做的。审计仍然由脚本另外启动的全新 Claude Code 来做：它只读、按 `docs/workflow/AUDITOR.md` 的规则审，看不到开发时的对话，和之前审 Codex 的方式一样。每一步的详细记录见 `docs/workflow/PROGRESS.md` 和 `docs/audits/`。

## 中间遇到的问题和处理

1. **我自己加的环境错误检测误判了一次。** Codex 读到 DEVLOG 里写着 `helper_unknown_error` 的那段说明，脚本就以为环境又坏了。实际上 Codex 已经正常做完了 STEP-01。
   - 处理：改成只认 Codex 自己打出来的那种错误日志行（`… ERROR codex_core::tools::router: error=exec_command failed: … helper_unknown_error`），并用 4 份旧故障日志和正常日志验证过。那次停下没有计入尝试次数。
2. **Codex 用量额度用完了两次**：第一次 08:22（提示 11:48 恢复，实际 10:48 就恢复了），第二次 11:31（提示 15:48 恢复）。
   - 处理：给脚本加了"额度用完"识别。识别到后，已写的部分改动单独提交为 `wip`，不审计、不计入尝试次数，写 BLOCKED.md 注明恢复时间。第一次额度用完时新识别还没加上，我在 STEP-06 第 2 次刚开始时手动结束了脚本，避免它空跑把剩下的尝试次数耗光。
3. **STEP-08 Codex 两次被打回**（第 1 次：Vite 代理把游戏记录接口转错了服务；第 2 次：为了不让玩家看别人的局，删掉了公开的查局接口，但 `check:provider` 还在用，导致失败）。
   - 处理：额度用完期间由我介入修好（**这一步唯一的一次介入**）。保留"只能查自己的局"的设计，把检查脚本、接口文档、模拟平台回放链接都改成用签名接口，并新增"别的玩家、错误签名都查不到"的检查。之后审计通过。
4. **改成由 Claude Code 开发后**，给 `scripts/autopilot.mjs` 加了"人工开发模式"（`AUTOPILOT_DEV=manual`）：不调用 Codex，只把已提交的代码交给审计；不通过就停下等修改，不自动重试。
5. **开发中自己发现并修好的 bug**（STEP-09）：后台路由少写一个 `await`，管理员密码输错一次就会让整个平台服务崩溃。已修好，测试里也覆盖了。

没有哪一步需要用到第 2 次介入，也没有卡住等你处理的步骤。

## 改了哪些文件（按提交）

自动接力脚本（`scripts/autopilot.mjs`）：
- `80e2f1c` Codex 环境错误时立刻停下，不消耗重试次数
- `2d569f7` 环境错误只认 Codex 自己的 ERROR 日志行（修误判）
- `e2915ea` Codex 用量额度用完时停下，不空耗尝试次数
- `34ef8be` 人工开发模式 `AUTOPILOT_DEV=manual`

功能代码：
- `fa2c49b` ~ `9077cf9`、`b5dfe82`、`ca2369d`、`adead2f`：STEP-01 ~ STEP-08 由 Codex 编写的提交（每步的提交号见 `docs/workflow/PROGRESS.md`）
- `23131c3` STEP-08 修复：局号查询改走签名接口（`server.mjs`、`scripts/provider-check.mjs`、`mock-operator.mjs`、`docs/PROVIDER_API.md`）
- `c937b3b` STEP-09 后台管理员、概览、玩家管理、操作日志（`server/platform/admin.mjs`、`ledger.mjs`、`schema.mjs`、`platform-server.mjs`、`src/admin/AdminApp.tsx`、`src/platform/admin.test.ts` 等）
- `e85f431` STEP-10 审核、交易流水、游戏记录、对账、故障模拟（含 `src/platform/admin-review.test.ts`，并发审核测试）
- `1e31b51` STEP-11 `npm run check:platform`、`npm start` 打印网址、`npm run admin:password`、README 重写
- `b16c602` 按 STEP-11 审计的轻微建议，小改 `admin:password`

流程记录：`47a11f7`、`8820d99`（中途报告）、`56853d9`（删除 BLOCKED.md），以及脚本自动生成的 `audit:`、`chore: … 基线` 提交。

另外改了项目外的 `%USERPROFILE%\.codex\config.toml`：`[windows] sandbox` 从 `"elevated"` 改成 `"unelevated"`，原文件备份在 `config.toml.bak`。

## 还需要你手动处理的

1. **第一次运行 `npm start` 时记下管理员密码。** 你本机的 `data/platform.sqlite` 还没创建，第一次启动会在终端打印一行 `[平台] 首次启动：已创建管理员账号 admin，初始密码 …`，只显示这一次。没看到也没关系，运行 `npm run admin:password` 可以重新生成。（我测试时用的是系统临时目录和 `data/admin-check/`，没有创建或改动 `data/platform.sqlite`；`data/admin-check/` 是浏览器检查留下的测试数据，可以直接删掉。）
2. **以后再跑 `npm run autopilot`，Codex 额度可能又会很快用完。** 计划里的 11 步都已完成，现在没有要跑的步骤了。新增步骤时，额度用完脚本会自己停下并注明恢复时间，不会浪费次数。

除此之外：无。

小提示（不用现在处理）：`docs/CLOUD_DEPLOY_TASK.md` 里有一条"保护 `/api/rounds/*`、`/api/replay/*`"，这两个接口已在 STEP-08 删除，上云时忽略即可。玩家和管理员的登录状态保存在内存里，平台服务重启后需要重新登录。
