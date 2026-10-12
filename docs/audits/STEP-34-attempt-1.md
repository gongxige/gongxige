# 审计报告：STEP-34 小额投注上线（第 1 次）

- 时间：2026/10/12 11:59:41
- 审计的提交：24587b3（比较起点 STEP-33-passed）
- 结果：**通过**

---

## 结论
STEP-34 验收标准全部达到：新局正确切换到第 2 版数学（投注 100/200/500/1,000/2,000），局记录和回放写入第 2 版 `mathConfigVersion`；第 1 版在途免费旋转按约定继续用原投注、原版本完整结算；前端投注控制和规则页因原本就从会话/引擎动态读取配置，无需改动即自动跟随第 2 版；两套检查脚本已改为小额投注且不再需要充值 2,000 万。全部指定命令实测通过。判定 PASS。

## 运行的检查
- `npm test` → 93/93 通过
- `npm run build` → 通过
- `npm run check:provider` → 全部通过（麻将投注改为 100，无测试补积分逻辑）
- `npm run check:platform` → 全部通过；麻将部分仅用注册送的 10,000 积分完成 50 付费局 + 20 免费局（共 70 局），无需充值
- `npm run rtp:mahjong`（完整 1,000 万回合）→ RTP 97.0053%，95% CI [96.5150%, 97.4955%]，落在目标 96.95% ± 0.10pp 区间内且 CI 包含目标值；封顶频率 0%；标准差 7.91×、第 99 百分位 21.12×，均在中等波动口径内
- `git diff STEP-33-passed..HEAD --stat` 核对改动范围：仅 `server.mjs`、`src/mahjong/engine/index.ts`、`scripts/platform-check.mjs`、`scripts/provider-check.mjs`、`src/platform/mahjong-platform.test.ts`、文档和 `state.json`；未触及 `src/engine/`（Wild Frontier）、`docs/MAHJONG_DESIGN.md`、`docs/MAHJONG_MATH.md`
- 人工核对 `src/mahjong/engine/engine.test.ts` 中“第 1 版记录按记录版本回放，与原局逐项完全一致”用例，确认旧局回放不受默认版本切换影响
- 人工核对 `server.mjs` 麻将回放调用 (`replayMahjongSpin`) 始终显式传入 `round.mathConfigVersion`，默认值切换到 V2 不影响任何真实历史记录的回放
- 人工核对前端 `src/mahjong/MahjongApp.tsx` 投注加减与规则弹窗均读取 `session.allowedBets` / 引擎导出的 `MAHJONG_MATH_CONFIG`，未改动文件本身已自动跟随第 2 版

## 问题
- [轻微] `src/mahjong/MahjongApp.tsx:46` — 规则弹窗的赔付表来自静态导入的 `MAHJONG_MATH_CONFIG`（现为 V2），如果玩家在部署时刚好有第 1 版在途免费旋转，旋转实际按 V1 结算，但规则页仍会显示 V2 的每路赔付数字，造成短暂的显示与实际不一致。属于历史过渡期的边缘情况（设计文档未对此提出显式要求），不影响资金正确性，不影响本次通过判定。

## 给 Codex 的修改要求
无（PASS，不要求修改；上面的轻微问题可自行决定是否在后续步骤顺带处理）。

VERDICT: PASS
