# Wild Frontier 1024 Ways（本机测试版）

5 × 4、1024 Ways 老虎机网页游戏，只在本机运行，只用虚拟积分。

- 开发计划与进度：[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)
- 开发日志：[docs/DEVLOG.md](docs/DEVLOG.md)

## 运行

```bash
npm install
npm run api   # 终端 1：本机测试服
npm run dev   # 终端 2：打开 http://127.0.0.1:4173
```

## 目录

```
src/engine/   游戏规则（纯逻辑 + 单元测试）
src/          React 界面
server.mjs    本机测试服（余额记账）
scripts/      工具脚本（RTP 报告）
docs/         计划、日志、归档
public/       运行时用到的图片
reference/    参考素材（不进 Git）
```
