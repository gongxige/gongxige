# 审计报告：STEP-08 玩家：游戏记录、个人中心（第 2 次）

- 时间：2026/10/11 11:31:21
- 审计的提交：adead2f（比较起点 STEP-07-passed）
- 结果：**不通过**

---

## 结论
STEP-08 的核心交付（游戏记录归属过滤、回放代理、改密）本身实现正确，也修复了第 1 次审计指出的 Vite 代理错配问题。但本次改动在 `server.mjs` 里**删除**了阶段 6 已完成并写入文档（`docs/PROVIDER_API.md`）的 `GET /api/rounds/{id}`、`GET /api/replay/{id}` 供应商接口，改成仅限平台内部调用的签名 `POST /provider/rounds`。这直接导致 `scripts/provider-check.mjs`（`npm run check:provider`）里原本会通过的回放一致性断言、派彩故障场景断言全部失效——这不是"遗留的历史缺陷"，而是本次 STEP-08 改动自己引入的回归，且 Codex 在 DEVLOG 里也承认了这一事实，却把它定性为"不在本次范围内"，没有同步修正测试脚本和文档。按 `docs/workflow/AUDITOR.md` 检查清单第 2 条（范围：是否改了无关的流程文件、造成既有功能倒退），这属于严重问题，判定为 **FAIL**。

## 运行的检查
- `git log STEP-07-passed..HEAD --oneline` → 确认本次比较范围含 STEP-08 第 1、2 次两次提交
- `git diff STEP-07-passed..HEAD`（全部改动文件）→ 逐行人工核对
- `git diff STEP-07-passed..HEAD --check` → 无空白符问题
- 阅读 `scripts/provider-check.mjs`、`docs/PROVIDER_API.md`、`server/rounds.mjs`、`server.mjs` 全量相关代码，静态确认回归链路
- `npm test` / `npm run build` / `npm run check:provider`：本次审计沙箱的终端权限策略拒绝执行任何 `npm` 命令（仅允许 `git status/diff/log` 等只读命令），**未能亲自运行**；以下结论基于静态代码追踪，并与 Codex 自己在 `docs/DEVLOG.md`（STEP-08 第 2 次条目）中记录的 `npm run check:provider` 失败描述一致，可相互印证

## 问题
- [严重] `server.mjs`（原 264-281 行的 `roundMatch` 路由被整段删除，新增于 `server.mjs:248-261` 的 `handleRoundLookup`）— 删除了阶段 6 已完成、`docs/PROVIDER_API.md:41-44` 仍在描述的公开 `GET /api/rounds/{roundId}`、`GET /api/replay/{roundId}`。`scripts/provider-check.mjs:79,87,97-99` 直接调用这两条路径做回放一致性和故障场景断言，路由被删后这些断言必然失败（`body.replay` 为 `undefined`，`body.replay.matches` 会抛错；`/api/replay/{id}` 返回 404）。这正是 Codex 在 `docs/DEVLOG.md` 第 7 行自述的"`check:provider` 回放断言失败"的根因——是本步改动直接造成的回归，不是预先存在、与本步无关的缺陷。
  - 应该怎么改：二选一，但都要让 `npm run check:provider` 重新通过且文档与实现一致：
    1. 保留新的 `POST /provider/rounds`（用于平台按 `playerId` 过滤/校验归属，这部分设计是对的），同时**恢复**原来的公开 `GET /api/rounds/{id}`、`GET /api/replay/{id}`（文档里本就注明"本机演示没有加权限"，恢复不会引入新的越权问题）；或
    2. 如果确定要用新接口取代旧接口，必须同步改掉 `scripts/provider-check.mjs` 里对旧路径的调用（改为走新接口或等价的内部调用方式）、更新 `docs/PROVIDER_API.md` 的"GET /api/rounds/{roundId}、GET /api/replay/{roundId}"章节，并让 `npm run check:provider` 实际跑通。
  - 无论哪种方案，都不能把"`check:provider` 失败"作为已知遗留问题留给以后的步骤——这是本步自己造成的倒退，必须在本步修完。
- [轻微] `docs/DEVELOPMENT_PLAN.md` 阶段 6 的勾选项"端到端检查 `npm run check:provider`：…"目前仍标 `[x]` 已完成，但现状已不成立，容易误导后续步骤；建议随上面的修复一并更新状态说明。

## 给 Codex 的修改要求
1. 按上面"问题"第一条的两个方案之一，修复供应商端的局号/回放查询接口，使其与 `scripts/provider-check.mjs`、`docs/PROVIDER_API.md` 保持一致。
2. 实际运行 `npm run check:provider` 直到全部通过（不是"前半段通过"），并在 `docs/DEVLOG.md` 本步条目里如实记录完整结果，不要再把自身引入的回归描述成"历史遗留、不在范围内"。
3. 如果 `docs/DEVELOPMENT_PLAN.md` 阶段 6 的勾选描述因此需要调整措辞，一并更新。
4. 本次游戏记录归属过滤、回放代理签名校验、改密流程、`vite.config.ts` 代理路由修复本身未发现问题，无需改动。

VERDICT: FAIL
