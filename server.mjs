import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const port = 8787;
const statePath = join(process.cwd(), 'data', 'local-slot-state.json');
const symbols = ['Q', 'K', '10', 'J', '9', 'A', 'elephant', 'bull', 'deer', 'lion', 'coin', 'zebra'];
const defaultState = { config: { title: 'Wild Frontier 本机测试服', startingCredits: 1000, allowedBets: [5, 10, 20, 50], theoreticalRtp: 96, maxPayoutMultiplier: 20, mode: 'local-demo', updatedAt: null }, sessions: {}, recentSpins: [] };

function load() { if (!existsSync(statePath)) return structuredClone(defaultState); try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return structuredClone(defaultState); } }
function save(state) { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state, null, 2)); }
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 32_000) reject(new Error('Request too large')); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } }); }); }
function randomGrid() { return Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => symbols[Math.floor(Math.random() * symbols.length)])); }
function makeResult(config, bet) {
  const grid = randomGrid();
  const row = Math.floor(Math.random() * 4);
  const prizeMultiplier = Math.max(1, Math.min(100, config.maxPayoutMultiplier));
  // Expected return = trigger probability × prize multiplier.  This makes the
  // displayed global RTP truthful for the local, virtual-credit demonstration.
  const wins = Math.random() < Math.min(1, (config.theoreticalRtp / 100) / prizeMultiplier);
  if (wins) { const symbol = symbols[Math.floor(Math.random() * symbols.length)]; for (let col = 0; col < 3; col += 1) grid[col][row] = symbol; }
  const multiplier = wins ? prizeMultiplier : 0;
  return { grid, winningCells: wins ? [0, 1, 2].map((col) => `${row}-${col}`) : [], payout: Math.round(bet * multiplier), multiplier };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`); const state = load();
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, mode: 'local-demo' });
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, state.config);
    if (req.method === 'GET' && url.pathname === '/api/session') { const sessionId = url.searchParams.get('sessionId') || 'local-browser'; const session = state.sessions[sessionId] ?? { credits: state.config.startingCredits }; return json(res, 200, { sessionId, credits: session.credits }); }
    if (req.method === 'GET' && url.pathname === '/api/recent-spins') return json(res, 200, state.recentSpins.slice(0, 20));
    if (req.method === 'POST' && url.pathname === '/api/config') { const input = await readBody(req); const rtp = Number(input.theoreticalRtp); const maxPayout = Number(input.maxPayoutMultiplier); if (!Number.isFinite(rtp) || rtp < 1 || rtp > 99 || !Number.isFinite(maxPayout) || maxPayout < 1 || maxPayout > 100) return json(res, 400, { error: 'RTP 必须在 1–99，最大倍率必须在 1–100。' }); state.config.theoreticalRtp = rtp; state.config.maxPayoutMultiplier = maxPayout; state.config.updatedAt = new Date().toISOString(); save(state); return json(res, 200, state.config); }
    if (req.method === 'POST' && url.pathname === '/api/spin') { const input = await readBody(req); const bet = Number(input.bet); const sessionId = String(input.sessionId || 'local-browser'); if (!state.config.allowedBets.includes(bet)) return json(res, 400, { error: '无效投注档位。' }); const session = state.sessions[sessionId] ?? { credits: state.config.startingCredits }; if (session.credits < bet) return json(res, 400, { error: '演示积分不足。' }); const result = makeResult(state.config, bet); session.credits = session.credits - bet + result.payout; state.sessions[sessionId] = session; state.recentSpins.unshift({ at: new Date().toISOString(), sessionId, bet, payout: result.payout, credits: session.credits, multiplier: result.multiplier }); state.recentSpins = state.recentSpins.slice(0, 100); save(state); return json(res, 200, { ...result, credits: session.credits }); }
    json(res, 404, { error: 'Not found' });
  } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : 'Bad request' }); }
}).listen(port, '127.0.0.1', () => console.log(`Local demo API: http://127.0.0.1:${port}`));
