# 开发日志

按时间倒序记录每次做了什么、怎么验证的、遗留了什么。计划和总进度见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)。

---

## 2026-10-09 · 阶段 0 + 阶段 1：项目整理、数学引擎

**做了什么**

- 建立 Git 仓库。第一个提交是整理前的原样快照，方便以后对比或回退。
- 把视频拆帧、截图、`q-test*.png`、旧版 `slot-game.html`、`reference-spin.mp4`、未使用的 `public/symbols/` 移到 `reference/`（被 `.gitignore` 忽略，文件都还在本机）。
- 依赖从 `latest` 改为锁定版本；新增 `@types/node`。
- 新建 `src/engine/`：
  - `symbols.ts` 符号、赔率表、投注规则
  - `reels.ts` 卷轴条带（固定种子洗牌生成）
  - `evaluate.ts` 1024 ways + Scatter 计算
  - `spin.ts` 一次旋转：随机停点 → 盘面 → 计算赢分 → 封顶
  - `rtp.ts` 精确理论 RTP
  - `engine.test.ts` 13 个单元测试
- 新建 `scripts/rtp-report.ts`（`npm run rtp`）。
- `server.mjs` 重写：结果全部来自引擎，用 `crypto.randomInt` 取随机停点；不再"先随机再强行改成三连"。
- `App.tsx` 适配新接口：投注档位、只读 RTP、最大赢分上限设置。
- 端口可通过 `API_PORT` / `WEB_PORT` 配置。

**怎么验证的**

- `npm test`：13/13 通过。
- `npm run rtp`：精确 RTP 96.68%；200 万次模拟 96.59%，中奖率约 36%。
- `npm run build`：通过（包含引擎和测试文件的类型检查）。
- 浏览器实测（另开 8797/4183 端口，没有动正在运行的旧服务）：连续旋转 8 次，余额变化正确；其中一次同时中 "J 5 连 × 1 路 = 400" 和 "9 3 连 × 2 路 = 80"，金额与赔率表手算一致，9 个中奖格全部高亮。
- 测试管理接口：非法值返回 400，合法值保存成功。

**遗留 / 注意**

- 前端动画还是旧实现（阶段 2 处理）。
- 中奖数字仍有旧的"先显示一半"逻辑（阶段 2 处理）。
- 界面仍叠在参考截图上，截图里的余额 542.33、投注 80 是假的（阶段 3 处理）。
- 你电脑上 4173/8787 端口有之前启动的旧 dev server 和旧 API（旧代码），需要重启 `npm run api` 才能用上新引擎。

---

## 2026-10-07 及之前 · 视觉复刻原型（已归档）

见 [archive/2026-10-07-visual-replica-plan.md](archive/2026-10-07-visual-replica-plan.md)。
