// Local demo API (virtual credits only). Every result comes from the game
// engine in src/engine: random reel stops → grid → ways/scatter evaluation.
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ALLOWED_BETS, computeRtp, isAllowedBet, spin } from './src/engine/index.ts';

const port = Number(process.env.API_PORT ?? 8787);
// v2: bets and payouts changed with the engine rewrite, so old balances are not carried over.
const statePath = join(process.cwd(), 'data', 'local-slot-state.v2.json');
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
  return { title: 'Wild Frontier 本机测试服', mode: 'local-demo', startingCredits, allowedBets: ALLOWED_BETS, theoreticalRtp, ...state.settings };
}
function sessionFor(state, sessionId) { return state.sessions[sessionId] ?? { credits: startingCredits }; }

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const state = load();
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, mode: 'local-demo' });
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, publicConfig(state));
    if (req.method === 'GET' && url.pathname === '/api/session') {
      const sessionId = url.searchParams.get('sessionId') || 'local-browser';
      return json(res, 200, { sessionId, credits: sessionFor(state, sessionId).credits });
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
      const bet = Number(input.bet);
      const sessionId = String(input.sessionId || 'local-browser');
      if (!isAllowedBet(bet)) return json(res, 400, { error: '无效投注档位。' });
      const session = sessionFor(state, sessionId);
      if (session.credits < bet) return json(res, 400, { error: '演示积分不足。' });

      const outcome = spin(bet, randomInt, state.settings.maxWinMultiplier);
      session.credits = session.credits - bet + outcome.payout;
      state.sessions[sessionId] = session;
      state.recentSpins.unshift({ at: new Date().toISOString(), sessionId, bet, payout: outcome.payout, credits: session.credits, stops: outcome.stops });
      state.recentSpins = state.recentSpins.slice(0, 100);
      save(state);

      const winningCells = [...new Set(outcome.wins.flatMap((win) => win.cells.map(({ reel, row }) => `${row}-${reel}`)))];
      return json(res, 200, { grid: outcome.grid, wins: outcome.wins, winningCells, payout: outcome.payout, capped: outcome.capped, credits: session.credits });
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : 'Bad request' });
  }
}).listen(port, '127.0.0.1', () => console.log(`Local demo API: http://127.0.0.1:${port}  (theoretical RTP ${theoreticalRtp}%)`));
