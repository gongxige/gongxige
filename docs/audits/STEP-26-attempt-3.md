# 审计报告：STEP-26 数学调校：RTP 96.95%、中等波动（第 3 次）

- 时间：2026/10/12 05:25:49
- 审计的提交：2f2cc5f（比较起点 STEP-25-passed）
- 结果：**通过**

---

## 结论
STEP-26 第 3 次尝试已达标：实测 RTP 96.9489%（95% CI 包含目标 96.95%），中奖频率、标准差、P99、封顶频率四项波动性指标均落在 `docs/MAHJONG_DESIGN.md` 规定的"中等波动"区间内，最高赢分低于 1,708 倍封顶且单元测试强制校验该上限。`npm test`、`npm run build`、`npm run rtp:mahjong` 均可正常运行，独立复核结果与文档完全一致。未发现资金、安全、原创素材或越权改动问题。

## 运行的检查
- `git diff STEP-25-passed..HEAD --stat` → 改动范围符合预期：`src/mahjong/engine/index.ts`、`engine.test.ts`、`scripts/rtp-mahjong.ts`、`package.json`、三份文档、流程文件；未触碰 `src/engine/`（Wild Frontier）、服务端或前端代码（`git diff` 中对 `src/engine` 的 grep 无匹配）。
- `npm test` → 85/85 通过。
- `npm run build` → `tsc -b && vite build` 成功。
- `npm run rtp:mahjong 2000000`（独立复核，固定种子）→ RTP 97.3735%、中奖频率 25.3967%、标准差 8.0399×，方向与 10,000,000 次结果一致。
- `npm run rtp:mahjong 10000000`（完整复核）→ RTP 96.9489%，95% CI [96.4493%, 97.4486%]，付费/免费贡献 80.8089%/16.1400%，中奖频率 25.3736%，免费触发频率 0.9012%，标准差 8.0608×，P99 21.07×，最高赢分 1404.71×，封顶 0/10,000,000 —— 与 `docs/MAHJONG_MATH.md`、`docs/DEVLOG.md` 记录的数字逐位一致，可信。
- 逐行阅读 `src/mahjong/engine/index.ts` 的全部改动（`createStrip`、`MAHJONG_MATH_CONFIG`、`payoutFor`）与 `engine.test.ts` 新增测试，确认金色变百搭、封顶、整数支付等 STEP-25 既有逻辑未被破坏，新测试（逐牌 3/4/5 列赔付 + 金色转百搭、1,708 倍上限）逻辑正确。

## 问题
无严重或中等问题。

轻微：`docs/MAHJONG_DESIGN.md` 第 49 行要求"正式投注档位必须保证所有配置后的支付结果为整数虚拟积分"，而当前有理数赔付表（如 `FA` 的 `1097/10000`）仅在投注恰为 10,000 的整数倍时才保证整数支付（`payoutFor` 在非整数时会抛错）。这是本步数学配置本身允许的设计（文档已预留"正式投注档位"由后续步骤确定），目前游戏 UI（`GameApp.tsx`/`ControlBar.tsx`）尚未接入麻将引擎，不影响本步验收，但建议在 STEP-27 之后接入真实下注档位时，审计该档位是否都能整除所有赔付分母，避免运行时抛错。

## 给 Codex 的修改要求
无（PASS）。

VERDICT: PASS
