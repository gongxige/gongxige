// Local demo API (virtual credits only). Every result comes from the game
// engine in src/engine: random reel stops → grid → ways/scatter evaluation.
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ALLOWED_BETS, ENGINE_VERSION, computeRtp, isAllowedBet, spin } from './src/engine/index.ts';

const port = Number(process.env.API_PORT ?? 8787);
// v2: bets and payouts changed with the engine rewrite, so old balances are not carried over.
const statePath = join(process.cwd(), 'data', process.env.STATE_FILE ?? 'local-slot-state.v2.json');
const theoreticalRtp = Math.round(computeRtp().total * 10000) / 100;
const MAX_WIN_RANGE = [50, 5000];
const defaultState = { settings: { maxWinMultiplier: 1000, updatedAt: null }, sessions: {}, recentSpins: [] };

function load() {
  if (!existsSync(statePath)) return structuredClone(defaultState);
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return structuredClone(defaultState); }
}
function save(state) { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state, null, 2)); }
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 32_000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}

const startingCredits = 10_000;
function publicConfig(state) {
  return { title: 'Wild Frontier 本机测试服', mode: 'local-demo', engineVersion: ENGINE_VERSION, startingCredits, allowedBets: ALLOWED_BETS, theoreticalRtp, ...state.settings };
}
// A session is { credits, freeSpins }. freeSpins is null, or the free-spin
// round in progress: { bet, remaining, played, totalWin }. It lives on the
// server so a reload resumes the round instead of losing it.
function sessionFor(state, sessionId) { return { freeSpins: null, ...(state.sessions[sessionId] ?? { credits: startingCredits }) }; }

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const state = load();
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, mode: 'local-demo' });
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, publicConfig(state));
    if (req.method === 'GET' && url.pathname === '/api/session') {
      const sessionId = url.searchParams.get('sessionId') || 'local-browser';
      const session = sessionFor(state, sessionId);
      return json(res, 200, { sessionId, credits: session.credits, freeSpins: session.freeSpins });
    }
    if (req.method === 'GET' && url.pathname === '/api/recent-spins') return json(res, 200, state.recentSpins.slice(0, 20));

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const input = await readBody(req);
      const maxWin = Number(input.maxWinMultiplier);
      if (!Number.isInteger(maxWin) || maxWin < MAX_WIN_RANGE[0] || maxWin > MAX_WIN_RANGE[1]) return json(res, 400, { error: `单次最大赢分倍数必须是 ${MAX_WIN_RANGE[0]}–${MAX_WIN_RANGE[1]} 的整数。` });
      state.settings = { maxWinMultiplier: maxWin, updatedAt: new Date().toISOString() };
      save(state);
      return json(res, 200, publicConfig(state));
    }

    if (req.method === 'POST' && url.pathname === '/api/spin') {
      const input = await readBody(req);
      const sessionId = String(input.sessionId || 'local-browser');
      const session = sessionFor(state, sessionId);
      const free = session.freeSpins;
      // During free spins the stored bet is used and nothing is charged.
      const bet = free ? free.bet : Number(input.bet);
      if (!free) {
        if (!isAllowedBet(bet)) return json(res, 400, { error: '无效投注档位。' });
        if (session.credits < bet) return json(res, 400, { error: '演示积分不足。' });
      }

      const outcome = spin(bet, randomInt, state.settings.maxWinMultiplier);
      session.credits += outcome.payout - (free ? 0 : bet);
      let freeSpinsFinished = null;
      if (free) {
        free.remaining += outcome.freeSpinsAwarded - 1;
        free.played += 1;
        free.totalWin += outcome.payout;
        if (free.remaining === 0) { freeSpinsFinished = { played: free.played, totalWin: free.totalWin }; session.freeSpins = null; }
      } else if (outcome.freeSpinsAwarded > 0) {
        session.freeSpins = { bet, remaining: outcome.freeSpinsAwarded, played: 0, totalWin: 0 };
      }
      state.sessions[sessionId] = session;
      state.recentSpins.unshift({ at: new Date().toISOString(), sessionId, mode: free ? 'free' : 'paid', bet, payout: outcome.payout, credits: session.credits, stops: outcome.stops });
      state.recentSpins = state.recentSpins.slice(0, 100);
      save(state);

      const winningCells = [...new Set(outcome.wins.flatMap((win) => win.cells.map(({ reel, row }) => `${row}-${reel}`)))];
      return json(res, 200, {
        engineVersion: ENGINE_VERSION,
        mode: free ? 'free' : 'paid',
        bet,
        stops: outcome.stops,
        grid: outcome.grid,
        wins: outcome.wins,
        winningCells,
        payout: outcome.payout,
        capped: outcome.capped,
        credits: session.credits,
        freeSpinsAwarded: outcome.freeSpinsAwarded,
        freeSpins: session.freeSpins,
        freeSpinsFinished,
      });
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : 'Bad request' });
  }
});

// Port already taken: usually an API started earlier is still running.
// Say whether it is up to date and how to stop it, instead of a stack trace.
server.on('error', async (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  const running = await fetch(`http://127.0.0.1:${port}/api/config`).then((r) => r.json()).catch(() => null);
  if (running?.engineVersion === ENGINE_VERSION) {
    console.log(`端口 ${port} 上已经有一个最新版本的本机测试服务在运行，不需要再启动。`);
  } else {
    console.log(`端口 ${port} 被${running ? '旧版本的本机测试服务' : '其他程序'}占用。`);
    console.log('在 PowerShell 里运行下面这行把它关掉，然后重新运行 npm run api：');
    console.log(`  Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => console.log(`Local demo API: http://127.0.0.1:${port}  (theoretical RTP ${theoreticalRtp}%, engine ${ENGINE_VERSION})`));
