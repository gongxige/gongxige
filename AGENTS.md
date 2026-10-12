# 给 Codex 的规则（本项目）

- 本项目是 **Vite + React + TypeScript**，不是 Next.js。上层目录 AGENTS.md 里的 Next.js 规则**不适用**于本项目。
- 你由 `scripts/autopilot.mjs` 自动调用，按 `docs/WORKFLOW_PLAN.md` 一步一步开发。每次调用只做提示里指定的**那一步**：
  - 不跳步，不提前做后面步骤的内容，不改与这一步无关的文件。
  - 如果提示里附了上一次的审计意见，必须逐条处理；不同意某条就在最后的总结里说明理由。
- **不要运行 `git commit`、`git reset`、`git checkout`、`git rebase`、`git push` 等改变 Git 历史的命令**。脚本会在你完成后统一提交，并打标签。可以用 `git diff`、`git status`、`git log` 查看。
- **只在本项目文件夹里工作**：不要读写项目文件夹以外的文件，不要安装全局软件，不要改系统设置。
- **不要使用电脑操作（computer use）、浏览器控制等会动用户鼠标键盘或桌面的工具**；需要运行命令就用终端。命令跑不起来就在总结里说明，交给审计处理。
- 不要修改：`docs/audits/`、`docs/workflow/`、`docs/WORKFLOW_PLAN.md`、`scripts/autopilot.mjs`、`AGENTS.md`。这些属于流程本身。
- Wild Frontier 的游戏规则在 `src/engine/`，**不改**。阶段 9 的新游戏「麻将连连胡」的规则写在它自己的目录（见 `docs/MAHJONG_DESIGN.md`）。所有游戏规则都必须是纯逻辑（不依赖 React、DOM、Node API）。
- 阶段 11 的「玉兔送财」规则同样写在它自己的目录（见 `docs/JADE_RABBIT_DESIGN.md`），不改另外两款游戏的规则。
- **不使用参考游戏（包括 PG《麻将胡了》《金钱兔》）的名字、标志、图片、音效、代码**；`reference/` 里的图片和录屏只能用来看，不能放进游戏、不能描摹；画面用 CSS / 内联 SVG / Canvas 自己画。
- `reference/` 是本机参考素材，不进 Git，也不要在运行时代码里引用。
- 这是**演示平台，只用虚拟积分**：不接任何真实支付、银行、第三方支付、加密货币；不收集银行卡号等真实收款信息。
- 新依赖尽量不加；必须加时锁定确切版本号（不用 `^`、`~`、`latest`）。
- 每完成一步：
  1. 运行这一步验收标准里的命令（至少 `npm test`；涉及前端时 `npm run build`；涉及钱包接口时 `npm run check:provider`），确认通过。
  2. 更新 `docs/DEVELOPMENT_PLAN.md`（当前阶段一节的勾选状态）。
  3. 在 `docs/DEVLOG.md` 顶部追加一条记录：做了什么、怎么验证的、遗留问题。
  4. 最后一条消息用中文总结：改了哪些文件、运行了哪些检查及结果、遗留问题。
