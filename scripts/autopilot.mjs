// npm run autopilot — Codex 写代码、Claude Code 审计，自动接力，不需要人转发消息。
//
// 按 docs/WORKFLOW_PLAN.md 的 STEP 顺序：
//   1. 让 Codex 做当前这一步（带上上一次的审计意见，如果有）
//   2. 脚本把改动提交到 Git
//   3. 让 Claude Code 审计（只读），报告存到 docs/audits/，也提交
//   4. 通过 → 打标签 STEP-xx-passed，进入下一步；不通过 → 带着报告打回给 Codex 重做
//   5. 同一步连续不通过 AUTOPILOT_MAX_ATTEMPTS 次（默认 4）→ 停下，写 docs/workflow/BLOCKED.md
//
// 随时可以按 Ctrl+C 停止；再运行 npm run autopilot 会从记录的位置接着做。
// 想在当前这一步做完后停下：新建一个空文件 .autopilot/STOP。
// 想回到某一步通过时的状态：git reset --hard STEP-xx-passed（会丢掉之后的改动，先确认）。
//
// 可调的环境变量：
//   AUTOPILOT_CODEX         启动 Codex 的命令（默认 codex）
//   AUTOPILOT_CLAUDE        启动 Claude Code 的命令（默认 claude）
//   AUTOPILOT_CODEX_ARGS    传给 codex 的参数（默认 exec --sandbox workspace-write -o .autopilot/codex-last.txt -）
//   AUTOPILOT_MAX_ATTEMPTS  同一步最多尝试几次（默认 4）
//   AUTOPILOT_ONLY_STEP     只跑到这一步为止（例如 STEP-03），方便先试一两步

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';

const PLAN = 'docs/WORKFLOW_PLAN.md';
const STATE = 'docs/workflow/state.json';
const PROGRESS = 'docs/workflow/PROGRESS.md';
const BLOCKED = 'docs/workflow/BLOCKED.md';
const AUDITS = 'docs/audits';
const WORK = '.autopilot';
const MAX_ATTEMPTS = Number(process.env.AUTOPILOT_MAX_ATTEMPTS ?? 4);
const ONLY_STEP = process.env.AUTOPILOT_ONLY_STEP ?? null;
const CODEX = process.env.AUTOPILOT_CODEX ?? 'codex';
const CLAUDE = process.env.AUTOPILOT_CLAUDE ?? 'claude';
const CODEX_LAST = `${WORK}/codex-last.txt`;
const CODEX_ARGS = process.env.AUTOPILOT_CODEX_ARGS ?? `exec --sandbox workspace-write -o ${CODEX_LAST} -`;
// The auditor may read and run checks, nothing else. dontAsk denies everything not listed here.
const AUDIT_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(npm test *)', 'Bash(npm test)', 'Bash(npm run *)', 'Bash(node --test *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git status *)', 'Bash(git status)'].join(',');
const CLAUDE_ARGS = `-p --output-format json --permission-mode dontAsk --allowedTools "${AUDIT_TOOLS}"`;
const HOURS = 60 * 60 * 1000;

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });
const say = (text) => console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${text}`);

// ---------- git ----------
function git(...args) { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function gitOk(...args) { try { git(...args); return true; } catch { return false; } }
function commitAll(message) {
  git('add', '-A');
  git('commit', '--allow-empty', '-m', message);
  return git('rev-parse', '--short', 'HEAD');
}

function ensureRepo() {
  if (!existsSync('.git')) { git('init'); say('已创建 Git 仓库。'); }
  if (!gitOk('config', 'user.name')) git('config', 'user.name', 'Autopilot');
  if (!gitOk('config', 'user.email')) git('config', 'user.email', 'autopilot@localhost');
  const ignore = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
  if (!ignore.split(/\r?\n/).includes('.autopilot/')) appendFileSync('.gitignore', `${ignore.endsWith('\n') || !ignore ? '' : '\n'}\n# 自动开发脚本的临时文件和日志\n.autopilot/\n`);
  if (git('status', '--porcelain')) {
    const hash = commitAll('chore: 自动开发开始前的基线（保存之前未提交的改动）');
    say(`工作区有未提交的改动，已先提交为基线 ${hash}。`);
  }
}

// ---------- plan & state ----------
function readSteps() {
  const text = readFileSync(PLAN, 'utf8').replace(/\r\n/g, '\n');
  const parts = text.split(/^### (?=STEP-\d+)/m).slice(1);
  if (!parts.length) throw new Error(`${PLAN} 里没有找到"### STEP-xx 标题"格式的步骤。`);
  return parts.map((part) => {
    const [head, ...body] = part.split('\n');
    const [, id, title] = head.match(/^(STEP-\d+)\s*(.*)$/);
    return { id, title: title.trim(), body: body.join('\n').split(/^---\s*$/m)[0].trim() };
  });
}

function loadState(steps) {
  // attempts: total tries per step (never reset, so report numbers stay unique); limits: when to stop and ask for help.
  const fresh = { passed: [], attempts: {}, limits: {}, baseline: git('rev-parse', 'HEAD') };
  const state = existsSync(STATE) ? { ...fresh, ...JSON.parse(readFileSync(STATE, 'utf8')) } : fresh;
  state.passed = state.passed.filter((id) => steps.some((s) => s.id === id));
  state.limits ??= {};
  // Someone handled a blocked step and deleted BLOCKED.md: allow another round of attempts.
  if (state.blocked && !existsSync(BLOCKED)) {
    state.limits[state.blocked] = (state.attempts[state.blocked] ?? 0) + MAX_ATTEMPTS;
    say(`${state.blocked} 之前卡住了，BLOCKED.md 已删除，再给 ${MAX_ATTEMPTS} 次机会。`);
    delete state.blocked;
  }
  return state;
}
function saveState(state) { mkdirSync('docs/workflow', { recursive: true }); writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`); }

function progressLine(cells) {
  if (!existsSync(PROGRESS)) writeFileSync(PROGRESS, '# 自动开发进度\n\n由 scripts/autopilot.mjs 自动维护。每一行是一次尝试。\n\n| 时间 | 步骤 | 第几次 | 结果 | 代码提交 | 审计报告 |\n|---|---|---|---|---|---|\n');
  appendFileSync(PROGRESS, `| ${cells.join(' | ')} |\n`);
}

// ---------- running the agents ----------
function quote(arg) { return /^[\w./:=@-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`; }

/** Runs `command args` through the shell (Windows needs it for codex.cmd / claude.cmd), feeding `input` on stdin. */
function run(command, args, input, logPath, timeoutMs) {
  return new Promise((resolve) => {
    const log = createWriteStream(logPath);
    const child = spawn(`${quote(command)} ${args}`, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => { log.write('\n[autopilot] 超时，已停止\n'); child.kill(); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; log.write(d); });
    child.stderr.on('data', (d) => log.write(d));
    child.on('error', (error) => { log.write(`\n[autopilot] 启动失败：${error.message}\n`); });
    child.on('close', (code) => { clearTimeout(timer); log.end(); resolve({ code, stdout }); });
    child.stdin.end(input);
  });
}

function codexPrompt(step, attempt, lastAudit) {
  return [
    `你正在按 ${PLAN} 自动开发。本次只做 ${step.id}（第 ${attempt} 次尝试）。`,
    '先读根目录 AGENTS.md 并遵守其中的规则（不要提交 Git，脚本会提交）。需要背景时读 docs/PLATFORM_TASK.md、docs/DEVELOPMENT_PLAN.md。',
    '',
    `## ${step.id} ${step.title}`,
    step.body,
    '',
    lastAudit
      ? `## 上一次审计没有通过，审计报告如下，请逐条处理\n\n${lastAudit}`
      : '## 这是这一步的第一次尝试',
    '',
    '完成后：运行验收标准里的检查命令，更新 docs/DEVELOPMENT_PLAN.md 和 docs/DEVLOG.md，最后用中文总结改了什么、检查结果、遗留问题。',
  ].join('\n');
}

function auditPrompt(step, attempt, base, codexSummary) {
  return [
    '你是本项目的代码审计员。先读 docs/workflow/AUDITOR.md，严格按其中的规则和输出格式审计。你只能看，不能改任何文件。',
    '',
    `本次审计：${step.id}（第 ${attempt} 次尝试）。比较起点：${base}。用 git diff ${base}..HEAD 查看这一步的全部改动。`,
    '',
    `## ${step.id} ${step.title}`,
    step.body,
    '',
    '## Codex 自己的总结（仅供参考，以你实际检查的结果为准）',
    codexSummary || '（没有总结）',
    '',
    '报告最后一行必须是 VERDICT: PASS 或 VERDICT: FAIL。',
  ].join('\n');
}

function parseAudit(stdout) {
  let text = stdout;
  try { text = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1)).result ?? stdout; } catch { /* plain text */ }
  const verdicts = [...String(text).matchAll(/VERDICT:\s*(PASS|FAIL)/g)];
  return { text: String(text).trim(), verdict: verdicts.length ? verdicts.at(-1)[1] : null };
}

/** Both CLIs must be installed and on PATH before anything is committed. */
function preflight() {
  for (const [name, command, hint] of [['Codex', CODEX, 'npm install -g @openai/codex，然后运行 codex 登录'], ['Claude Code', CLAUDE, '安装 Claude Code，然后运行 claude 登录']]) {
    try { execFileSync(`${quote(command)} --version`, { shell: true, stdio: 'ignore' }); }
    catch { throw new Error(`找不到 ${name}（命令 ${command}）。请先安装并登录：${hint}`); }
  }
  try { git('--version'); } catch { throw new Error('找不到 git，请先安装 Git for Windows。'); }
}

// ---------- main loop ----------
async function main() {
  preflight();
  mkdirSync(`${WORK}/logs`, { recursive: true });
  mkdirSync(AUDITS, { recursive: true });
  ensureRepo();
  const steps = readSteps();
  const state = loadState(steps);
  saveState(state);
  say(`共 ${steps.length} 步，已通过 ${state.passed.length} 步。`);

  for (const step of steps) {
    if (state.passed.includes(step.id)) continue;
    if (existsSync(`${WORK}/STOP`)) { say('发现 .autopilot/STOP，按要求停下。删除这个文件后重新运行即可继续。'); return 0; }

    const previousPass = [...state.passed].reverse().find((id) => gitOk('rev-parse', `${id}-passed`));
    const base = previousPass ? `${previousPass}-passed` : state.baseline;
    let lastAudit = null;
    // Resume: if the last attempt of this step failed, hand its report to Codex again.
    const done = state.attempts[step.id] ?? 0;
    if (done > 0 && existsSync(join(AUDITS, `${step.id}-attempt-${done}.md`))) lastAudit = readFileSync(join(AUDITS, `${step.id}-attempt-${done}.md`), 'utf8');

    while (true) {
      const attempt = (state.attempts[step.id] ?? 0) + 1;
      const limit = state.limits[step.id] ?? MAX_ATTEMPTS;
      if (attempt > limit) {
        state.blocked = step.id;
        saveState(state);
        writeFileSync(BLOCKED, `# 自动开发卡住了\n\n时间：${now()}\n\n${step.id} ${step.title} 连续 ${MAX_ATTEMPTS} 次没有通过审计，脚本已停下，需要人看一下。\n\n- 最近的审计报告：docs/audits/${step.id}-attempt-${attempt - 1}.md\n- 上一个通过的版本：${base}（如需回退：git reset --hard ${base}）\n- 处理完后：删除本文件，再运行 npm run autopilot，脚本会从这一步接着做，再给 ${MAX_ATTEMPTS} 次机会。\n`);
        commitAll(`chore(autopilot): ${step.id} 连续 ${MAX_ATTEMPTS} 次未通过，停下等待处理`);
        say(`${step.id} 连续 ${MAX_ATTEMPTS} 次没通过，已停下。详情见 ${BLOCKED}。`);
        return 2;
      }
      state.attempts[step.id] = attempt;
      saveState(state);

      // 1. Codex
      say(`${step.id} 第 ${attempt} 次：Codex 开始写代码…（日志 ${WORK}/logs/${step.id}-${attempt}-codex.log）`);
      if (existsSync(CODEX_LAST)) writeFileSync(CODEX_LAST, '');
      const codex = await run(CODEX, CODEX_ARGS, codexPrompt(step, attempt, lastAudit), `${WORK}/logs/${step.id}-${attempt}-codex.log`, 3 * HOURS);
      const summary = existsSync(CODEX_LAST) ? readFileSync(CODEX_LAST, 'utf8').trim() : '';
      if (codex.code !== 0) say(`Codex 退出代码 ${codex.code}（仍然提交现有改动并交给审计判断）。`);

      // 2. Commit Codex's work
      const firstLine = (summary.split('\n').find((l) => l.trim()) ?? '（无总结）').replace(/^#+\s*/, '').slice(0, 72);
      const codeCommit = commitAll(`${step.id} 第${attempt}次: ${step.title}\n\n${summary.slice(0, 4000) || firstLine}\n\n[autopilot] 由 Codex 编写，等待 Claude Code 审计`);
      say(`已提交 ${codeCommit}。Claude Code 开始审计…`);

      // 3. Claude Code audit (read-only); one retry if the report has no verdict line
      let audit = null;
      for (let tryNo = 1; tryNo <= 2 && !audit?.verdict; tryNo += 1) {
        const result = await run(CLAUDE, CLAUDE_ARGS, auditPrompt(step, attempt, base, summary), `${WORK}/logs/${step.id}-${attempt}-audit-${tryNo}.log`, 1 * HOURS);
        audit = parseAudit(result.stdout);
      }
      const verdict = audit.verdict ?? 'FAIL';
      const reportPath = join(AUDITS, `${step.id}-attempt-${attempt}.md`);
      writeFileSync(reportPath, `# 审计报告：${step.id} ${step.title}（第 ${attempt} 次）\n\n- 时间：${now()}\n- 审计的提交：${codeCommit}（比较起点 ${base}）\n- 结果：**${verdict === 'PASS' ? '通过' : '不通过'}**\n\n---\n\n${audit.text || '（审计没有返回内容）'}\n${audit.verdict ? '' : '\n> 脚本注：审计报告缺少 VERDICT 行，按不通过处理。\n'}`);
      const relReport = reportPath.replace(/\\/g, '/');
      progressLine([now(), `${step.id} ${step.title}`, String(attempt), verdict === 'PASS' ? '✅ 通过' : '❌ 打回', codeCommit, `[报告](../audits/${relReport.split('/').pop()})`]);

      if (verdict === 'PASS') {
        state.passed.push(step.id);
        saveState(state);
        commitAll(`audit: ${step.id} 第${attempt}次 通过`);
        git('tag', '-f', `${step.id}-passed`);
        say(`✅ ${step.id} 审计通过，已打标签 ${step.id}-passed。`);
        break;
      }
      saveState(state);
      commitAll(`audit: ${step.id} 第${attempt}次 不通过，打回重做`);
      say(`❌ ${step.id} 审计不通过，带着报告打回给 Codex。`);
      lastAudit = readFileSync(reportPath, 'utf8');
    }

    if (ONLY_STEP && step.id === ONLY_STEP) { say(`已完成到 ${ONLY_STEP}，按 AUTOPILOT_ONLY_STEP 停下。`); return 0; }
  }
  say('🎉 全部步骤都已通过审计。');
  return 0;
}

const code = await main().catch((error) => { console.error(`[autopilot] 出错：${error.message}`); return 1; });
process.exit(code);
