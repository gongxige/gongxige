# 审计报告：STEP-41 玉兔送财画面：布局、符号、吉祥物、转动（第 1 次）

- 时间：2026/10/12 16:34:52
- 审计的提交：1f3eea3（比较起点 STEP-40-passed）
- 结果：**不通过**

---

## 结论
STEP-41 的 `npm run build`、`npm test`（107/107）、范围、原创素材、文档记录检查均通过；但中奖线发光展示（JADE_RABBIT_TASK.md 第二节要求的"中奖线画成一条发光的火焰线"）存在坐标计算错误：左右两个 3 行卷轴的纵坐标仍按 4 行换算，导致发光线在这两列上的落点与真实格子位置偏差最大约 20 个百分点，视觉上线条会穿过错误的格子。这是本步骤明确要做的画面内容里的真实功能性缺陷，判定为 **FAIL**。

## 运行的检查
- `npm run build` → 通过（`tsc -b && vite build` 无错误）
- `npm test` → 通过，107/107
- `git diff STEP-40-passed..HEAD --check` → 无空白/冲突标记问题
- `git diff STEP-40-passed..HEAD --stat` → 本步骤只改了 `src/App.tsx`（挂路由）、`src/rabbit/JadeRabbitApp.tsx`（新文件）、`src/styles.css`（追加玉兔专属规则）及 `docs/DEVELOPMENT_PLAN.md`、`docs/DEVLOG.md`、`docs/workflow/state.json`；未触碰 `src/engine/`、`src/rabbit/engine/`、`server.mjs` 或其他无关文件，范围符合要求。
- 读取 `src/rabbit/engine/index.ts` 核对 `BOARD_HEIGHTS`、`PAYLINES`、`PAYTABLE`、`BONUS_MULTIPLIERS`、`MAX_WIN_MULTIPLIER`、`Token.bonusTier` 的实际定义，与 `JadeRabbitApp.tsx` 里的使用和 `PAYTABLE_LABELS` 映射逐项核对，均一致、无遗漏符号。
- 全文通读 `src/rabbit/JadeRabbitApp.tsx`、新增的 `styles.css` 规则，手工推演 `.rabbit-stage`/`.rabbit-reels`/`.rabbit-reel-column`/`.rabbit-bottom` 在 390×844（竖屏）、844×390（`max-height:520px and orientation:landscape` 命中专属布局）、1366×768（`min(100vw,620px)` 限宽，居中显示）三种尺寸下的盒模型与媒体查询命中情况，确认舞台宽高、按钮可点击区域、底部控制区在三种尺寸下都不会被裁出屏幕或互相重叠；在此过程中发现了下方的中奖线坐标问题。
- 在 `src/rabbit/`、`src/App.tsx`、`src/styles.css` 中检索参考游戏名称（"金钱兔"、"Fortune Rabbit"、"PG"）及 `reference/` 引用，均未发现。
- 核对 `docs/DEVELOPMENT_PLAN.md`（STEP-41 勾选为 `[x]` 并注明尝试次数）与 `docs/DEVLOG.md`（顶部新增本步骤记录，含"做了什么/怎么验证的/遗留问题"）均已更新。

## 问题
- [中等] `src/rabbit/JadeRabbitApp.tsx:283` — `linePath` 用 `((y + 0.5) / 4) * 100` 统一换算纵坐标，但只有中间卷轴（x=1）是 4 行，左右两个卷轴（x=0、x=2）实际只有 3 行且用 `flex:1 1 0` 平均撑满整列高度，真实格子中心应是 `(y + 0.5) / 3`。10 条固定线每条都至少经过一次左/右卷轴，所以每次展示中奖线时，发光折线在这两列上的位置都会偏离真实格子（偏差最大约 20 个百分点），和"中奖符号外面一圈光环""其他符号压暗"（这部分按格子坐标算，没问题）对不上，视觉上线和被点亮的格子不一致，违反了 STEP-41 要做的"中奖线展示"画面要求。

## 给 Codex 的修改要求
1. 修复 `src/rabbit/JadeRabbitApp.tsx:283` 的坐标换算：纵坐标分母要按该列实际行数算，不能固定写 4。可以改成 `((y + 0.5) / BOARD_HEIGHTS[x]) * 100`（`BOARD_HEIGHTS` 已从引擎导出，直接复用即可），横坐标的 `/3` 不用改（3 列本身没变）。
2. 修好后请自己在三种目标尺寸（390×844、844×390、1366×768）下，用源码/数值方式重新核对 10 条线里任意几条触及左右卷轴的线（例如线 1、线 4、线 10）算出的折线坐标，确认落在对应格子的垂直范围内（不要只肉眼看一下，建议直接代入 `BOARD_HEIGHTS`、`PAYLINES` 的数字手算验证）。
3. 回归 `npm run build`、`npm test`，确认仍然通过；更新 `docs/DEVLOG.md` 补充这次修正的记录（做了什么、怎么验证的）。

VERDICT: FAIL
