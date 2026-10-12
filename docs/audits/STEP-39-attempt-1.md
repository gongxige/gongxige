# 审计报告：STEP-39 数学调校：RTP 96.75%、中等波动（第 1 次）

- 时间：2026/10/12 15:00:59
- 审计的提交：13036da（比较起点 STEP-38-passed）
- 结果：**通过**

---

## 结论
STEP-39 验收标准全部达到：实测 RTP、置信区间、波动性指标和封顶行为均与文档一致，`npm test`、`npm run build` 通过，且改动范围仅限于玉兔送财引擎、脚本和文档。判定 PASS。

## 运行的检查
- `npm test` → 107/107 通过，含新增的 2,000 局正式数学配置封顶测试。
- `npm run build` → 通过（tsc + vite build 无错误）。
- `npm run rtp:rabbit -- 2000000`（独立复核方向）→ RTP 96.2929%，标准差 5.8105×，中奖率 36.4977%，P99 10.40×，封顶 0 次。
- `npm run rtp:rabbit -- 10000000`（完整 1,000 万轮复现）→ RTP **96.7614%**，95% 置信区间 **[96.3995%, 97.1233%]**，标准差 5.8388×，中奖率 36.4992%，触发率 0.7440%，最高 178.70×，封顶 0 次 —— 与 `docs/JADE_RABBIT_MATH.md` 报告的数字逐项一致。
- `git diff STEP-38-passed..HEAD --stat` → 只改了 `docs/*`、`package.json`、`scripts/rtp-rabbit.ts`、`src/rabbit/engine/index.ts`、`src/rabbit/engine/engine.test.ts`，未触及 `src/engine/`（Wild Frontier）、麻将引擎或服务器代码。
- 核对固定赔付：`PAYTABLE` 中 `WILD=200`、`YUANBAO=100`、`FU_BAG=50`、`RED_ENVELOPE=10` 未被本次 diff 改动。
- 核对波动标准来源：`docs/JADE_RABBIT_DESIGN.md` 第 299～306 行的"中等波动"区间（中奖率 20%～45%、标准差 3～12 倍、P99 10～100 倍、封顶≤2/1,000,000）与 `JADE_RABBIT_MATH.md` 引用的验收区间完全一致，实测数字全部落在区间内。
- 核对轴带构造：`mathMainStrip`/`mathModeStrip` 的符号和档位数量与文档表格逐项核对（主轴 88 普通符号+12 牌匾=100；模式轴 50 牌匾+50 空白，档位 10/20/12/6/2）。

## 问题
- [轻微] `src/rabbit/engine/index.ts:104-109` — `deterministicShuffle` 后合并连续同 `symbolId` 的 `stackGroupId` 时只比较 `symbolId`，不比较 `bonusTier`；如果洗牌后两个档位不同的 `BONUS_PLATE` 恰好相邻，画面上会被视觉归并成同一叠放组，但 `bonusTier` 本身不受影响、结算正确。只是未来做前端叠放动画时可能出现"同一叠里牌匾倍数不一样"的违和感，可在 STEP-41 画面阶段一并处理，不影响本步数学结论。

## 给 Codex 的修改要求
无（PASS，不要求本次修改；上面的轻微问题留给后续画面步骤参考即可）。

VERDICT: PASS
