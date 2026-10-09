# 项目说明（给 AI 助手）

- 这是 **Vite + React + TypeScript** 项目，不是 Next.js；上层目录 AGENTS.md 里的 Next.js 规则不适用于本项目。
- 开工前先读 `docs/DEVELOPMENT_PLAN.md`（目标、阶段、进度）。
- 游戏规则只写在 `src/engine/`，它必须保持纯逻辑（不依赖 React、DOM、Node API），服务端和前端都从这里引用。
- 改动 `src/engine/` 后运行 `npm test` 和 `npm run rtp`。
- 每完成一项工作：更新 `docs/DEVELOPMENT_PLAN.md` 的勾选状态，并在 `docs/DEVLOG.md` 顶部追加一条记录（做了什么、怎么验证、遗留问题）。
- `reference/` 是本机参考素材，不进 Git，也不要在运行时代码里引用。
