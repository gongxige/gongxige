# 审计报告：STEP-38 引擎：奖金符号、玉兔模式、5,000 倍封顶、回放（第 1 次）

- 时间：2026/10/12 14:43:04
- 审计的提交：5123d91（比较起点 STEP-37-passed）
- 结果：**通过**

---

## 结论
STEP-38 的验收标准均已达到，核心结算逻辑（奖金牌匾计数、百搭边界、玉兔模式 8 次、5,000 倍封顶、回放）与设计文档逐项对应且测试覆盖到位，判定 **PASS**。

## 运行的检查
- `npm test` → 106/106 通过，含 STEP-38 新增 5 个测试（4 不赔/5 以上赔总和、百搭边界、模式恰好 8 次且仅含奖金牌匾/空白格、5,000 倍封顶截断、2,000 局随机回放完全一致）
- `npm run build` → `tsc -b && vite build` 通过
- `git diff STEP-37-passed..HEAD --check` → 无空白符问题
- `git diff STEP-37-passed..HEAD --stat` → 只改动 `src/rabbit/engine/index.ts`、`src/rabbit/engine/engine.test.ts`、`docs/DEVELOPMENT_PLAN.md`、`docs/DEVLOG.md`、`docs/workflow/state.json`；确认 `src/engine/`（Wild Frontier）无改动
- 搜索 `src/` 下对 `reference/` 的引用 → 无
- 逐行阅读 `index.ts` 对照 `docs/JADE_RABBIT_DESIGN.md` 第 4、5、6 节核对公式：封顶顺序 `payable=min(candidate, cap-totalWin); totalWin+=payable` 与 `capSpin`/`settleModeSpin` 实现完全一致；奖金牌匾换算、百搭替代边界、线奖判定均与文档一致
- 尝试额外跑一个独立的大样本方向性模拟脚本做抽样核对，但该临时脚本执行被 Bash 权限策略拒绝（审计规则只明确允许 `npm test`/`npm run build`/`npm run check:provider` 等既定命令），已改为仅靠阅读源码和既有单元测试完成判断，未强行绕过权限

## 问题
- [轻微] `src/rabbit/engine/index.ts:407` — `settleRound` 要求触发玉兔模式时 `modeStops.length` 必须严格等于 8，即使封顶导致后续旋转根本不会执行，记录里仍要求补满 8 组停点，比设计文档 5.2 节“最多 8 组”的措辞更严格。不影响任何验收标准或资金正确性，只是和文档字面表述略有出入，可在 STEP-39 或文档层面统一说明（服务器预先抽满 8 组再按封顶截断处理）即可，不要求本次返工。
- [轻微] `src/rabbit/engine/engine.test.ts:202-224` — 2,000 局回放对比用的轴带不含 `BONUS_PLATE`、模式轴带只有 `BLANK`，所以这个批量模糊测试实际没有覆盖到“5 个以上牌匾赔总和”和“触顶截断”两条路径（这两条已由前面两个独立测试覆盖，只是没有和批量回放结合）。建议后续可以把这两类场景也纳入批量回放对比,但不影响本步通过。

## 给 Codex 的修改要求
无需修改，以上两点仅为后续可选优化建议。

VERDICT: PASS
