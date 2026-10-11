# 审计报告：STEP-27 游戏服务器支持多款游戏（第 1 次）

- 时间：2026/10/12 05:43:43
- 审计的提交：90d8bd3（比较起点 STEP-26-passed）
- 结果：**通过**

---

## 结论
STEP-27（第 1 次）验收标准全部达到：服务端已按 `gameId` 区分 Wild Frontier 与麻将连连胡，麻将每局走扣款→确定性结果→永久记录→派彩，免费旋转状态按 `operator:player:game` 隔离并持久化；局记录和回放带上 `gameId`，麻将回放可完整重现初始/最终牌面与每一步 `cascadeSteps`；Wild Frontier 的接口、规则版本号和 `src/engine/` 未被改动。`npm test`、`npm run build`、`npm run check:provider` 均亲自跑过且全部通过（含麻将连转对账、逐局回放一致、派彩故障补发、扣款超时回滚）。未发现资金正确性、安全或演示边界问题。

## 运行的检查
- `git diff STEP-26-passed..HEAD --stat` → 只改了 `server.mjs`、`server/replay-page.mjs`、`scripts/provider-check.mjs`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`、`docs/workflow/state.json`；`src/engine/`、`src/mahjong/engine/`、`docs/WORKFLOW_PLAN.md` 均未改动，范围符合本步骤。
- `npm test` → 85/85 通过。
- `npm run build` → `tsc -b && vite build` 通过。
- `npm run check:provider` → 全部通过，包括新增的"麻将连连胡连续旋转：每局扣款或免费、派彩、对账、连锁回放均一致"和"麻将连连胡派彩故障进入补发，扣款超时自动回滚且对账正确"，以及原有 Wild Frontier"连转 10 局"检查（确认未被削弱）。
- 人工复核 `server.mjs` 的 `handleMahjongSpin`、`handleLaunch`、`handleRoundLookup`：playerKey 按 `operatorId:playerId:gameId` 隔离；封顶余额 `capRemainingBefore` 在免费旋转间正确跨局传递；0 元派彩仍调用一次 `win` 的模式与 Wild Frontier 原有设计一致；会话 `gameId` 由服务端在 launch 时写入，客户端无法在 spin 时越权切换游戏。
- 人工比对 `docs/MAHJONG_DESIGN.md` 第 8.1/5 节与改动：局记录新增 `gameId`、`engineVersion`、`mathConfigVersion`、`stripRevision`、`replayInput`、`cascadeSteps` 等字段，回放按 `gameId` 分派引擎，与设计一致。

## 问题
- [轻微] server.mjs:249-310 — `handleMahjongSpin` 里投注校验硬编码 `bet !== 10_000`，没有复用同一文件里刚定义的 `GAMES['mahjong-cascade'].isAllowedBet`，两处判断逻辑重复，以后改配置容易漏改一处。
- [轻微] server.mjs:310-320 — `POST /provider/rounds` 的列表分支没有像设计文档 8.1 节提到的那样支持可选 `gameId` 过滤（单局查询和回放已正确按 `gameId` 分派，只是批量列表查询暂不能按游戏缩小范围）。
- [轻微] server/replay-page.mjs:66 — 麻将回放页用了 `class="mahjong-board"`，但页面的 `<style>` 里没有定义这个类，棋盘展示会退回成无样式的普通 `div`；回放页是内部客服/运营工具，不影响派彩正确性。
- [轻微] server.mjs:248-296 — 麻将分支的错误文案（如 "Invalid mahjong bet."、"Previous round is still being processed."）是英文，与同文件 Wild Frontier 分支的中文错误文案（如"上一局还在处理中。"）风格不一致。

以上均为轻微建议，不影响本步骤通过。

VERDICT: PASS
