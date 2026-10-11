# 审计报告：STEP-30 接入平台（第 1 次）

- 时间：2026/10/12 06:10:50
- 审计的提交：f742a2f（比较起点 STEP-29-passed）
- 结果：**通过**

---

## 结论
STEP-30（接入平台）验收标准全部达到：平台大厅新增麻将连连胡卡片并可启动，玩家/后台游戏记录与概览能按游戏区分，点局号可回放麻将连连胡；Wild Frontier 入口和记录不受影响。四个指定命令全部通过，且新增测试确实覆盖了"玩家只能看到自己的麻将记录"这一要求。未发现跳步、越权改动引擎/流程文件、资金正确性或安全问题。

## 运行的检查
- `npm test` → 90/90 通过（含新增的 `src/platform/mahjong-platform.test.ts` 3 个用例）
- `npm run build` → 通过（tsc -b && vite build 成功）
- `npm run check:provider` → 全部通过（含麻将连续旋转、回放、派彩故障/扣款超时）
- `npm run check:platform` → 全部通过（含并发下注、对账一致性等资金场景）
- 手工复核 `git diff STEP-29-passed..HEAD`：仅改了 `platform-server.mjs`、`src/App.tsx`、`src/admin/AdminApp.tsx`、`src/styles.css`、新测试文件及文档；未触及 `src/engine/`、`server.mjs`（游戏服务器侧 gameId 支持是 STEP-27 已有的，本步只是把 `gameId` 透传过去）
- 手工复核 `/games/:gameId/launch` 路由顺序：未登录先 401，已登录但未知游戏再 404，与测试断言一致
- 手工复核 `/api/admin/overview` 的 `games` 统计与总览 `since`（今天起点）保持一致；核对了 round 记录只有在扣款成功后才会写入（超时回滚发生在写入之前），因此无需像 `bets` 总览那样额外排除 `refunded` 状态

## 问题
无严重或中等问题。

轻微（不影响通过）：
- `platform-server.mjs:174-182` 的 `/overview` 每次请求都会向游戏服务器请求最近 500 局并在内存里做一次全量统计，数据量增长后有性能成本，但当前规模下可接受，且是只读查询，不涉及资金正确性。

## 给 Codex 的修改要求
无（PASS）。

VERDICT: PASS
