// Local demo platform. It owns virtual-credit wallets and exposes the
// provider-v1 wallet contract used by server.mjs. No real-money features.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { json, html, parseJson, readRaw, signedPost, verify } from './server/http.mjs';
import { openPlatformDatabase } from './server/platform/db.mjs';
import { LedgerError, createDepositRequest, createPlayer, approveDeposit, creditWin, getWallet, placeBet, reconcilePlayer, refundBet } from './server/platform/ledger.mjs';

export const PLATFORM_PROTOCOL = 'provider-v1';
const port = Number(process.env.OPERATOR_PORT ?? 8788);
const operatorId = process.env.OPERATOR_ID ?? 'demo-operator';
const secret = process.env.OPERATOR_SECRET ?? 'local-demo-secret';
const providerUrl = process.env.PROVIDER_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 8787}`;
const db = openPlatformDatabase(join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), process.env.PLATFORM_DB_FILE ?? 'platform.sqlite'));

function seedPlayer(id, username, amount) {
  if (db.prepare('SELECT id FROM players WHERE id = ?').get(id)) return;
  createPlayer(db, { id, username });
  const requestNo = `initial-credit-${id}`;
  createDepositRequest(db, { playerId: id, requestNo, amount });
  approveDeposit(db, { requestNo, reviewedBy: 'bootstrap' });
}
seedPlayer('player-001', '玩家一', 10_000);
seedPlayer('player-002', '玩家二', 10_000);

let fault = { kind: 'none', remaining: 0 };
const slowTransactions = new Set();
// Checks can shorten this while still exceeding the RGS 3-second bet timeout.
const SLOW_MS = Number(process.env.SLOW_BET_MS ?? 8000);
const isAmount = (value, zero = false) => Number.isSafeInteger(value) && (zero ? value >= 0 : value > 0);
const fail = (res, status, code, error) => json(res, status, { code, error });

function walletResponse(res, action, input) {
  const { playerId, transactionId, roundId, amount } = input;
  try {
    if (action === 'balance') return json(res, 200, { playerId, balance: getWallet(db, playerId).balance, currency: 'DEMO' });
    if (!transactionId || !roundId || !isAmount(amount, action === 'win')) return fail(res, 400, 'BAD_REQUEST', `${action === 'win' ? '派彩' : '扣款'}参数不完整`);
    if (action === 'bet') {
      const row = db.prepare('SELECT status FROM provider_transactions WHERE transaction_id = ?').get(transactionId);
      if (row?.status === 'cancelled') return fail(res, 409, 'TRANSACTION_CANCELLED', '这笔扣款已被回滚，不能再扣');
      const result = placeBet(db, { playerId, transactionId, roundId, amount });
      const answer = () => json(res, 200, { transactionId, balance: result.balance, duplicate: result.idempotent || undefined });
      if (slowTransactions.has(transactionId)) return setTimeout(answer, SLOW_MS);
      if (fault.kind === 'slow-bet') {
        fault = { kind: 'none', remaining: 0 };
        slowTransactions.add(transactionId);
        setTimeout(() => slowTransactions.delete(transactionId), 60_000).unref();
        return setTimeout(answer, SLOW_MS);
      }
      return answer();
    }
    if (action === 'win') {
      if (fault.kind === 'win-down' && fault.remaining > 0) {
        fault.remaining -= 1;
        if (!fault.remaining) fault = { kind: 'none', remaining: 0 };
        return fail(res, 500, 'TEMPORARY_ERROR', '（模拟故障）平台暂时无法派彩');
      }
      const result = creditWin(db, { playerId, transactionId, roundId, amount });
      return json(res, 200, { transactionId, balance: result.balance, duplicate: result.idempotent || undefined });
    }
  } catch (error) {
    if (error instanceof LedgerError) return fail(res, error.code === 'INSUFFICIENT_FUNDS' ? 402 : 404, error.code, error.message);
    throw error;
  }
}

function walletRefund(res, input) {
  const { playerId, transactionId, refTransactionId, roundId } = input;
  if (!transactionId || !refTransactionId) return fail(res, 400, 'BAD_REQUEST', '回滚参数不完整');
  try {
    const result = refundBet(db, { playerId, transactionId, refTransactionId, roundId });
    return json(res, 200, { transactionId, balance: result.balance, duplicate: result.idempotent || undefined });
  } catch (error) {
    if (error instanceof LedgerError) return fail(res, 404, error.code, error.message);
    throw error;
  }
}

function state() {
  const players = {};
  for (const player of db.prepare('SELECT id, username FROM players ORDER BY id').all()) {
    const wallet = getWallet(db, player.id);
    const reconciliation = reconcilePlayer(db, player.id);
    players[player.id] = { name: player.username, balance: wallet.balance, deposits: db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE player_id = ? AND kind = 'deposit_approved'").get(player.id).total, ok: reconciliation.balanceMatches && reconciliation.frozenMatches };
  }
  const transactions = db.prepare(`SELECT transaction_id AS txId, kind AS type, player_id AS playerId, round_id AS roundId, amount, status, balance_after AS balanceAfter, created_at AS at, ref_transaction_id AS refTransactionId FROM ledger_entries ORDER BY created_at`).all();
  return { players, transactions };
}

async function launch(playerId, res) {
  const player = db.prepare('SELECT id, username FROM players WHERE id = ?').get(playerId);
  if (!player) return html(res, 404, '没有这个玩家');
  try {
    const { status, body } = await signedPost(`${providerUrl}/provider/launch`, { operatorId, playerId: player.id, playerName: player.username, currency: 'DEMO' }, { secret, operatorId });
    if (status !== 200 || !body.gameUrl) throw new Error(body.error || `HTTP ${status}`);
    res.writeHead(302, { location: body.gameUrl }); res.end();
  } catch (error) { html(res, 502, `<meta charset="utf-8"><p>游戏服务器没有响应：${error.message}</p>`); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, role: 'platform', protocol: PLATFORM_PROTOCOL, operatorId });
    if (req.method === 'GET' && url.pathname === '/') return html(res, 200, '<meta charset="utf-8"><h1>演示平台</h1><p>仅虚拟积分。</p>');
    if (req.method === 'GET' && url.pathname === '/launch') return launch(url.searchParams.get('player'), res);
    if (req.method === 'GET' && url.pathname === '/admin/state') return json(res, 200, state());
    if (req.method === 'POST' && url.pathname === '/admin/fault') {
      const form = new URLSearchParams(await readRaw(req)); const kind = form.get('kind');
      fault = kind === 'win-down' ? { kind, remaining: 4 } : kind === 'slow-bet' ? { kind, remaining: 1 } : { kind: 'none', remaining: 0 };
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/wallet/')) {
      const raw = await readRaw(req);
      if (req.headers['x-operator-id'] !== operatorId || !verify(raw, req.headers['x-signature'], secret)) return fail(res, 401, 'BAD_SIGNATURE', '签名不对，拒绝处理');
      const input = parseJson(raw); const action = url.pathname.slice('/wallet/'.length);
      if (action === 'refund') return walletRefund(res, input);
      if (['balance', 'bet', 'win'].includes(action)) return walletResponse(res, action, input);
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) { json(res, 400, { code: 'BAD_REQUEST', error: error instanceof Error ? error.message : 'Bad request' }); }
});
server.on('error', (error) => { if (error.code === 'EADDRINUSE') { console.log(`端口 ${port} 已被占用。`); process.exit(1); } throw error; });
server.listen(port, '127.0.0.1', () => console.log(`演示平台: http://127.0.0.1:${port}  平台编号 ${operatorId}`));
