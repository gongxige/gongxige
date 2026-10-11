# 审计报告：STEP-21 中奖压暗变轻、手机上转动更流畅、自动旋转中奖多停一会（第 1 次）

- 时间：2026/10/12 00:35:19
- 审计的提交：227ce0d（比较起点 STEP-20-passed）
- 结果：**通过**

---

## 结论
STEP-21 验收标准全部达到：非中奖格压暗变轻（brightness .66 / saturate .7 / opacity .8，均在要求区间内）且中奖加框/闪烁/百搭发光未改动；转动中 `.reel-slot img` 通过更高特异度选择器强制 `filter: none`，停下后自动恢复原有滤镜；位移改为 `translate3d`，`will-change: transform` 已保留（该属性在 STEP-20 之前就已存在，本步未新增但也未破坏）；付费自动旋转中奖后等待 2000ms、未中奖保持 280ms，且补充了对应测试，免费游戏和大奖逻辑未触碰。`npm test`、`npm run build` 均通过，改动范围干净，未涉及 `src/engine/` 或资金/安全相关代码。

## 运行的检查
- `npm test` → 72/72 全部通过（含新增的 `keeps winning paid auto spins visible for at least two seconds...` 测试）
- `npm run build` → `tsc -b && vite build` 成功
- `git diff STEP-20-passed..HEAD --stat` / 按文件逐一 `git diff` → 改动仅限 `src/GameApp.tsx`、`src/game/autoSpin.ts`、`src/game/game.test.ts`、`src/styles.css`、`src/useReels.ts` 及文档/流程状态文件，`src/engine/` 未改动
- 手工核对 CSS 选择器特异度：确认 `.reel-column.is-spinning .reel-slot img { filter: none }`（特异度 0,3,1）高于基础 `.reel-slot img { filter: contrast(...)... }`（0,1,1），转动时能正确覆盖；停止后 `is-spinning` 类移除，基础滤镜自动恢复
- 核对 `win.amount` 状态流转（`GameApp.tsx:180,192`）：每次 spin 开始时清零、结果落地后才赋值，确认自动旋转效果读取的是刚结束这一局的真实输赢，不是陈旧值；该写法与已验证过的免费旋转 `FREE_SPIN_DELAY_MS` 模式一致

## 问题
- [轻微] src/styles.css:95 — 新增的 `.reel-column.is-spinning .reel-slot.is-hush img` 选择器实际不可达：`is-hush` 只在 `motion.isIdle`（该列已停）时打到格子上，而同一列的 `is-spinning` 只在 `motion.isFast`（该列还在转）时才加到列上，二者对同一列互斥，所以这段选择器永远匹配不到任何元素，纯粹是死代码。不影响功能（因为该情形本就不会发生），只是读起来容易让人误以为还有一层特殊逻辑。可以删掉这半句，只保留 `.reel-column.is-spinning .reel-slot img { filter: none; }`。

## 给 Codex 的修改要求
无需修改（上述问题为轻微建议，不影响通过）。

VERDICT: PASS
