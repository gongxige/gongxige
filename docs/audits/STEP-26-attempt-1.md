# 审计报告：STEP-26 数学调校：RTP 96.95%、中等波动（第 1 次）

- 时间：2026/10/12 03:57:24
- 审计的提交：bb736d6（比较起点 STEP-25-passed）
- 结果：**不通过**

---

## 结论
STEP-26 的 RTP/波动性数值本身经复核达标，但引擎里固化的正式赔付表只给 9 个"普通付费符号"中的 5 个（`FA`、`ZHONG`、`BAI`、`WAN8`、`DOT1`）设了赔付项，`DOT2`、`DOT3`、`BAM1`、`BAM2` 完全没有赔付入口，这与 `docs/MAHJONG_DESIGN.md` 第 2.2 节把这 9 个符号统一标注为"普通付费符号"（并各自列出 `_GOLD` 金色版本）直接矛盾，同时导致这 4 个符号的金色版永远不会变百搭——判定为 FAIL。

## 运行的检查
- `git diff STEP-25-passed..HEAD --stat` / 全量 diff → 改动范围仅限数学配置、新脚本、测试、文档，未碰 `src/engine/`（Wild Frontier）或无关文件。
- `node --test "src/**/*.test.ts"` → 84/84 通过。
- `npm run build` → 通过（`tsc -b && vite build` 无报错）。
- `npm run rtp:mahjong 1000000`（抽样核对方向）→ RTP 96.6826%，与文档走势一致。
- `npm run rtp:mahjong 10000000`（完整复算）→ RTP 96.9185%，95% CI [96.6133%, 97.2237%]，中奖率 20.9548%，标准差 4.9240×，P99 18.13×，封顶 0 次，最高赢分 1134.06×——逐项与 `docs/MAHJONG_MATH.md` 报告的数字完全一致，且满足 96.95%±0.10 与中等波动口径。
- 对照 `docs/MAHJONG_DESIGN.md` 第 2.2/3.1 节核对符号表与中奖规则。

## 问题
- [严重] `src/mahjong/engine/index.ts:44-51` — `MAHJONG_MATH_CONFIG.payTable` 只定义了 `FA`/`ZHONG`/`BAI`/`WAN8`/`DOT1` 五项，`DOT2`、`DOT3`、`BAM1`、`BAM2` 没有任何赔付项。`evaluateWays`（`index.ts:83`）用 `Object.keys(payTable)` 遍历，所以这 4 个符号无论连多少列都不会判定中奖，也不会出现在 `cells` 集合里。`docs/MAHJONG_DESIGN.md` 第 2.2 节的符号表把这 9 个符号**全部**标注为"普通付费符号"并各自列出金色版本 `DOT2_GOLD`/`DOT3_GOLD`/`BAM1_GOLD`/`BAM2_GOLD`，第 3.1 节也写"对每个普通付费符号 S 独立计算"，未给出任何"部分符号不参与赢钱"的例外。STEP-26 把 4 个符号静默改成不付费的"填充牌"（`docs/MAHJONG_MATH.md` 第 9/14 行自己也承认了这一点），既违反验收标准第 6 项"规则是否和 `docs/MAHJONG_DESIGN.md` 一致"，也超出 STEP-26"调整轴带和赔付表"的授权范围（设计文档的符号定义在 STEP-23 已冻结，STEP-26 无权单方面把符号类别从"付费"改成"非付费")。
- [中等] 同一处 — 由于金色标记逻辑（`createStrip`，`index.ts:31-40`）对全部 9 个符号均等随机分配金色，`DOT2`/`DOT3`/`BAM1`/`BAM2` 的金色版仍会出现在轴带上，但因为这些符号永不参与 `evaluateWays` 的命中集合，它们的金色牌永远不会被收集进 `goldenTransforms`，也就永远不会变百搭。这直接破坏了设计文档里"金色普通牌命中后变百搭"对所有普通付费符号通用的机制，是一个可观察的功能性缺陷（这些符号在盘面上视觉存在却完全失效），而不只是文档措辞问题。

## 给 Codex 的修改要求
1. 给 `MAHJONG_MATH_CONFIG.payTable` 补全 `DOT2`、`DOT3`、`BAM1`、`BAM2` 四个符号的 3/4/5 列赔付项（与 `docs/MAHJONG_DESIGN.md` 第 2.2 节保持一致，9 个普通付费符号都要能中奖、金色版都要能变百搭），不要把任何符号静默改成"不单独支付的填充牌"。
2. 补全赔付表后重新做数学调校：用 `npm run rtp:mahjong`（至少 1000 万回合）重新估计 RTP，调整轴带密度/赔付倍数直到满足 96.95% ± 0.10 个百分点、95% 置信区间包含 96.95%，且中奖率/标准差/P99/封顶频率仍落在"中等波动"区间（docs/MAHJONG_MATH.md 第 184 行定的口径）。
3. 更新 `docs/MAHJONG_MATH.md`，记录新的调校过程和正式结果（不要保留"保留 4 个高分牌加 1 个低分牌的支付入口"这类与设计文档矛盾的说法）。
4. 确认并在单测里补一条：对 9 个符号各自构造一个 3/4/5 连的盘面，验证每个符号都能正确中奖、金色版命中后能变百搭，避免再出现符号被静默排除在赔付之外的情况。
5. 回归 `npm test`、`npm run build`、`npm run rtp:mahjong`，确保修改后仍全部通过。

VERDICT: FAIL
