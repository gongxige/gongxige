# 审计报告：STEP-33 数学第 2 版调校（第 1 次）

- 时间：2026/10/12 11:45:52
- 审计的提交：8944c33（比较起点 STEP-32-passed）
- 结果：**通过**

---

## 结论
STEP-33 的数学第 2 版调校已按设计实现：赔付表分母改为 100、分层清晰，第 1 版配置原样冻结只供回放，`replaySpin` 按记录版本号选配置且版本缺失时报错；`rtp:mahjong` 默认模拟第 2 版并在输出中标注版本。服务器新局仍使用第 1 版（符合 WORKFLOW_PLAN.md 把投注档位切换和新局上线划给 STEP-34 的范围），不算跳步。各项验收标准均达成，可以通过。

## 运行的检查
- `npm test` → 93/93 通过。
- `npm run rtp:mahjong 2000000`（自测复核方向）→ RTP 97.3866%，中奖率 25.40%，标准差 7.89×，最高赢分 839.88×，封顶 0 次；与 Codex 报告的 10,000,000 次结果（RTP 97.0053%，CI [96.5150%, 97.4955%]，含 96.95%，标准差 7.91×，最高 1242.26×，封顶 0 次）方向一致，均落在“中等波动”区间（命中 20%–45%、标准差 3–12×）且远低于 1,708× 上限。
- `npm run build` → 通过。
- `git diff STEP-32-passed..HEAD --check` → 无空白符问题。
- `git diff STEP-32-passed..HEAD --stat` 人工核对改动范围：仅 `src/mahjong/engine/`、`scripts/rtp-mahjong.ts`、`server.mjs`、`server/replay-page.mjs`、`docs/*`，未触及 `src/engine/`（Wild Frontier）。
- 人工比对 `docs/MAHJONG_DESIGN.md` §2.3 分层赔付表（高 11/33/132%、中 6/18/79%、低 1/3/12%，分母 100）与 `MAHJONG_MATH_CONFIG_V2` 代码逐项一致；第 1 版 `mahjong-math-1.2.0`/`mahjong-strips-1.2.0` 数值未被改动。
- 核对 `engine.test.ts` 新增三个用例：五档投注大量随机局整数派彩、九种牌全覆盖且低档 5 列 ≥1%、第 1 版记录按版本号回放逐项一致（`assert.deepEqual`）+ 未知版本报错。
- 核对 `server.mjs`、`server/replay-page.mjs`：新局创建仍用 `MAHJONG_MATH_CONFIG`（= V1），回放路径改为按 `round.mathConfigVersion` 查配置，向后兼容旧记录。

## 问题
- [轻微] `src/mahjong/engine/index.ts:147-150` — `replaySpin` 在只传入 `strips` 或只传入 `payTable` 其中一个（不传另一个）时会抛出运行时异常（`config` 判空后仍访问 `config!.xxx`），因为 `strips || payTable` 为真时放弃按版本查表，但缺失的那一半又没有默认值兜底。目前代码库里所有调用（生产代码与测试）都只传 1 个参数或都不传覆盖参数，未触发此路径，不影响本次验收，但建议 STEP-34 前修一下，避免日后有人传半套参数时在生产环境炸掉。

## 给 Codex 的修改要求
无需修改即可通过；上面的轻微问题可在后续步骤顺手处理，不是本次 FAIL 的理由。

VERDICT: PASS
