# 审计报告：STEP-47 中奖线改成参考游戏的 10 条（第 1 次）

- 时间：2026/10/13 00:36:54
- 审计的提交：5e012ba（比较起点 STEP-46-passed）
- 结果：**通过**

---

## 结论
STEP-47 的验收标准全部达到。新的 10 条线正好是 3-4-3 盘面上「只连相邻格」的全部组合。旧局按 1.1.0 旧线回放能 100% 重现。换线不改变理论线奖 RTP，我用穷举计算核实了这一点，新旧两套线都是 48.2030%。服务器在「旧版本触发、模式中途升级」时，局记录的版本也正确。Wild Frontier 引擎和麻将引擎都没有改动。没有发现严重或中等问题。

## 运行的检查
- `git diff STEP-46-passed..HEAD --stat` → 改了 10 个文件。b4ea1cc 只改了 `docs/DEVELOPMENT_PLAN.md`、`docs/WORKFLOW_PLAN.md`，是阶段 13 计划；5e012ba 是本步的实现。`src/engine/`、`src/mahjong/` 的 diff 为空。
- `npm test` → 117/117 通过。
- `npm run build` → 通过。
- `node scripts/rtp-rabbit.ts 1000000` → 配置 jade-rabbit-math-1.2.0。RTP 96.5197%，95% 置信区间 [95.3744%, 97.6649%]，包含 96.75%。线奖贡献 48.3157%，中奖频率 36.7453%，最高 156×。方向和 DEVLOG 里 1000 万轮的 96.7678% 一致。
- 自写穷举脚本（在 scratchpad 中）：遍历 100×100×100 全部停点，分别用新线、旧线计算线奖期望。
  - 每条线的线奖都是 4.820300%，新旧两套线合计都是 48.203000%，完全相等。理由是每列符号的分布与所在行无关，三列又相互独立，所以论证成立。
  - 同一脚本列举「侧列第 r 格只连中列第 r 或 r+1 格」的全部组合：共 10 种，与 `PAYLINES` 集合完全相同。
- 对比脚本：用 STEP-46-passed 的旧引擎（`git archive` 解压到 scratchpad）结算 20,000 局随机 1.1.0 局，含约 5% 触发模式。再用新引擎的 `replayRound` 回放，20,000/20,000 整轮结果逐字节一致。其中 6,583 局如果改按新线算会不同，说明旧线确实被正确选用。
- 服务器版本升级实测：
  - 用 `restart.sh` 加参数 0 启动后，换成旧版 server.mjs，打 1 局付费局并触发模式，再打 2 局模式局，记录版本是 1.1.0。
  - 停掉旧服务、在同一数据目录启动新 server.mjs，继续打完剩下 6 局模式局。返回值和局记录都是 1.1.0，第 8 局正常结束；随后的新付费局是 1.2.0。
  - 用新引擎回放 rounds.jsonl 里的全部 10 条记录，全部 MATCH（派彩、停点、lineWins 一致，记录版本等于 replayInput 版本）。
- `npm run check:provider` → 全部通过，包括玉兔送财付费父局、8 次模式局、派彩故障、扣款超时。
- `npm run check:platform` → 全部通过，包括玉兔送财 50 个付费局加 400 个模式局，对账一致。
- `lines.mjs` 390×844 → 4 次核对，命中线 4、5、6、9 号。高亮格都等于服务器 lineWins，线经过格子中心的误差为 0px，全部是相邻格。
- `lines.mjs` 1366×768 → 2 次核对，命中线 2、9 号。结果同上。
- 截图都在 scratchpad/audit47/。
  - 规则页（m-rules.png、d-rules.png）：10 张 3-4-3 小格子图，中列高半格，高亮格和线表一致。
  - 中奖截图（m-win-2.png）：线从左中经中列第 2 格到右上，只连相邻格。
- 代码核对：
  - `paylinesForVersion` 遇到未知版本会直接报错；`validateReplayInput` 不再只接受当前版本。
  - 前端 `activeWinCells` 和画线都改用 `resultLineWins` 里的 coordinates；本地 `PAYLINES` 只用于规则页示意图。
  - server.mjs 的模式局记录和返回值改用 `free.replayInput` 里的版本；`handleRoundLookup` 和 replay-page 回放的都是记录里的 replayInput。
- `git status` → 工作区干净，`public/local-assets/` 没有进 Git。
- 最后用 `restart.sh` 不带第二个参数重启了一次，8787 健康检查正常。

## 问题
- [轻微] src/rabbit/engine/index.ts:50 — `PAYLINES_V1` 上方还留着旧注释「按设计文档冻结的 10 条线」，和下一行的新注释叠在一起，容易误读 — 删掉旧注释，或把它移到新的 `PAYLINES` 上。
- [轻微] src/rabbit/JadeRabbitApp.tsx:121 — 1366×768 下规则弹窗加了示意图之后变高，「知道了」按钮在第一屏只露出一半。弹窗是 `overflow:auto`，能滚动，不影响使用 — 后续 STEP-48 检查规则页时可以顺便压缩一下间距。
- [轻微] 建议补一个测试，把 1.1.0 旧局的真实服务器记录做成固定样本来回放。现有测试用的是人工轴带加旧线表；本次审计已用旧引擎和服务器升级实测补齐了这项证据，所以不影响通过。

## 给 Codex 的修改要求
（PASS，无强制修改。）

VERDICT: PASS
