import { randomUUID } from 'node:crypto';
import { inTransaction } from './db.mjs';

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const id = () => randomUUID();

function assertPositiveInteger(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new LedgerError('INVALID_AMOUNT', '金额必须是正安全整数');
  }
}

function wallet(db, playerId) {
  const row = db.prepare('SELECT balance, frozen_balance FROM wallets WHERE player_id = ?').get(playerId);
  if (!row) throw new LedgerError('PLAYER_NOT_FOUND', '玩家不存在');
  return row;
}

function addLedgerEntry(db, values) {
  const current = wallet(db, values.playerId);
  db.prepare(`INSERT INTO ledger_entries (
    id, transaction_id, player_id, kind, amount, balance_delta, frozen_delta,
    balance_after, frozen_after, status, round_id, request_id, ref_transaction_id, reason, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`)
    .run(id(), values.transactionId, values.playerId, values.kind, values.amount,
      values.balanceDelta, values.frozenDelta, current.balance, current.frozen_balance,
      values.roundId ?? null, values.requestId ?? null, values.refTransactionId ?? null,
      values.reason ?? null, now());
}

function changeWallet(db, playerId, balanceDelta, frozenDelta) {
  const change = db.prepare(`UPDATE wallets
    SET balance = balance + ?, frozen_balance = frozen_balance + ?, updated_at = ?
    WHERE player_id = ? AND balance + ? >= 0 AND frozen_balance + ? >= 0`)
    .run(balanceDelta, frozenDelta, now(), playerId, balanceDelta, frozenDelta);
  if (change.changes !== 1) throw new LedgerError('INSUFFICIENT_FUNDS', '可用余额或冻结余额不足');
}

function recordProviderTransaction(db, values) {
  db.prepare(`INSERT INTO provider_transactions (
    transaction_id, operation, player_id, round_id, status, ledger_entry_id,
    ref_transaction_id, request_hash, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'completed', (SELECT id FROM ledger_entries WHERE transaction_id = ?), ?, NULL, ?, ?)`)
    .run(values.transactionId, values.operation, values.playerId, values.roundId ?? null,
      values.transactionId, values.refTransactionId ?? null, now(), now());
}

export function createPlayer(db, { id: playerId = id(), username, initialCredit = 0 }) {
  if (!username?.trim()) throw new LedgerError('INVALID_PLAYER', '用户名不能为空');
  if (!Number.isSafeInteger(initialCredit) || initialCredit < 0) throw new LedgerError('INVALID_INITIAL_CREDIT', '初始演示积分无效');
  return inTransaction(db, () => {
    const timestamp = now();
    db.prepare('INSERT INTO players (id, username, status, created_at, updated_at) VALUES (?, ?, \'active\', ?, ?)')
      .run(playerId, username.trim(), timestamp, timestamp);
    db.prepare('INSERT INTO wallets (player_id, balance, frozen_balance, updated_at) VALUES (?, 0, 0, ?)')
      .run(playerId, timestamp);
    if (initialCredit > 0) {
      db.prepare('UPDATE wallets SET balance = ?, updated_at = ? WHERE player_id = ?').run(initialCredit, timestamp, playerId);
      db.prepare(`INSERT INTO ledger_entries (
        id, transaction_id, player_id, kind, amount, balance_delta, frozen_delta,
        balance_after, frozen_after, status, round_id, request_id, ref_transaction_id, reason, created_at
      ) VALUES (?, ?, ?, 'registration_credit', ?, ?, 0, ?, 0, 'completed', NULL, NULL, NULL, '演示账号初始积分', ?)`)
        .run(id(), `registration-credit:${playerId}`, playerId, initialCredit, initialCredit, initialCredit, timestamp);
    }
    return { id: playerId, username: username.trim() };
  });
}

export function getWallet(db, playerId) {
  const current = wallet(db, playerId);
  return { balance: current.balance, frozen_balance: current.frozen_balance };
}

export function createDepositRequest(db, { playerId, requestNo, amount }) {
  assertPositiveInteger(amount);
  if (!requestNo) throw new LedgerError('INVALID_REQUEST', '申请号不能为空');
  return inTransaction(db, () => {
    wallet(db, playerId);
    const requestId = id();
    db.prepare(`INSERT INTO deposit_requests (id, request_no, player_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)`)
      .run(requestId, requestNo, playerId, amount, now());
    return { id: requestId, requestNo, status: 'pending' };
  });
}

export function approveDeposit(db, { requestNo, reviewedBy = 'system' }) {
  return inTransaction(db, () => {
    const request = db.prepare('SELECT * FROM deposit_requests WHERE request_no = ?').get(requestNo);
    if (!request || request.status !== 'pending') throw new LedgerError('REQUEST_NOT_PENDING', '充值申请不可审核');
    const changed = db.prepare("UPDATE deposit_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
      .run(reviewedBy, now(), request.id);
    if (changed.changes !== 1) throw new LedgerError('REQUEST_NOT_PENDING', '充值申请已处理');
    changeWallet(db, request.player_id, request.amount, 0);
    addLedgerEntry(db, { playerId: request.player_id, transactionId: `deposit-approved:${request.id}`,
      kind: 'deposit_approved', amount: request.amount, balanceDelta: request.amount, frozenDelta: 0, requestId: request.id });
    return getWallet(db, request.player_id);
  });
}

export function createWithdrawalRequest(db, { playerId, requestNo, amount }) {
  assertPositiveInteger(amount);
  if (!requestNo) throw new LedgerError('INVALID_REQUEST', '申请号不能为空');
  return inTransaction(db, () => {
    wallet(db, playerId);
    const requestId = id();
    changeWallet(db, playerId, -amount, amount);
    db.prepare(`INSERT INTO withdrawal_requests (id, request_no, player_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)`)
      .run(requestId, requestNo, playerId, amount, now());
    addLedgerEntry(db, { playerId, transactionId: `withdrawal-freeze:${requestId}`,
      kind: 'withdrawal_freeze', amount, balanceDelta: -amount, frozenDelta: amount, requestId });
    return { id: requestId, requestNo, status: 'pending', ...getWallet(db, playerId) };
  });
}

export function approveWithdrawal(db, { requestNo, reviewedBy = 'system' }) {
  return inTransaction(db, () => {
    const request = db.prepare('SELECT * FROM withdrawal_requests WHERE request_no = ?').get(requestNo);
    if (!request || request.status !== 'pending') throw new LedgerError('REQUEST_NOT_PENDING', '提现申请不可审核');
    const changed = db.prepare("UPDATE withdrawal_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
      .run(reviewedBy, now(), request.id);
    if (changed.changes !== 1) throw new LedgerError('REQUEST_NOT_PENDING', '提现申请已处理');
    changeWallet(db, request.player_id, 0, -request.amount);
    addLedgerEntry(db, { playerId: request.player_id, transactionId: `withdrawal-approved:${request.id}`,
      kind: 'withdrawal_approved', amount: request.amount, balanceDelta: 0, frozenDelta: -request.amount, requestId: request.id });
    return getWallet(db, request.player_id);
  });
}

export function placeBet(db, { playerId, transactionId, amount, roundId = null }) {
  assertPositiveInteger(amount);
  if (!transactionId) throw new LedgerError('INVALID_TRANSACTION', '交易号不能为空');
  return inTransaction(db, () => {
    const prior = db.prepare('SELECT transaction_id FROM provider_transactions WHERE transaction_id = ?').get(transactionId);
    if (prior) return { idempotent: true, ...getWallet(db, playerId) };
    const player = db.prepare('SELECT status FROM players WHERE id = ?').get(playerId);
    if (!player) throw new LedgerError('PLAYER_NOT_FOUND', '玩家不存在');
    if (player.status !== 'active') throw new LedgerError('PLAYER_FROZEN', '玩家已冻结');
    changeWallet(db, playerId, -amount, 0);
    addLedgerEntry(db, { playerId, transactionId, kind: 'bet', amount, balanceDelta: -amount, frozenDelta: 0, roundId });
    recordProviderTransaction(db, { transactionId, operation: 'bet', playerId, roundId });
    return { idempotent: false, ...getWallet(db, playerId) };
  });
}

export function creditWin(db, { playerId, transactionId, amount, roundId = null }) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new LedgerError('INVALID_AMOUNT', '派彩金额必须是非负安全整数');
  if (!transactionId) throw new LedgerError('INVALID_TRANSACTION', '交易号不能为空');
  return inTransaction(db, () => {
    const prior = db.prepare('SELECT transaction_id FROM provider_transactions WHERE transaction_id = ?').get(transactionId);
    if (prior) return { idempotent: true, ...getWallet(db, playerId) };
    wallet(db, playerId);
    changeWallet(db, playerId, amount, 0);
    addLedgerEntry(db, { playerId, transactionId, kind: 'win', amount, balanceDelta: amount, frozenDelta: 0, roundId });
    recordProviderTransaction(db, { transactionId, operation: 'win', playerId, roundId });
    return { idempotent: false, ...getWallet(db, playerId) };
  });
}

/**
 * Reverse one provider bet.  If the bet has not arrived yet, reserve its
 * transaction ID as cancelled so a delayed retry cannot charge the player.
 */
export function refundBet(db, { playerId, transactionId, refTransactionId, roundId = null }) {
  if (!transactionId || !refTransactionId) throw new LedgerError('INVALID_TRANSACTION', '交易号不能为空');
  return inTransaction(db, () => {
    const duplicate = db.prepare('SELECT transaction_id FROM provider_transactions WHERE transaction_id = ?').get(transactionId);
    if (duplicate) return { idempotent: true, ...getWallet(db, playerId) };

    wallet(db, playerId);
    const bet = db.prepare('SELECT * FROM provider_transactions WHERE transaction_id = ?').get(refTransactionId);
    let amount = 0;
    if (!bet) {
      db.prepare(`INSERT INTO provider_transactions (
        transaction_id, operation, player_id, round_id, status, ledger_entry_id,
        ref_transaction_id, request_hash, created_at, updated_at
      ) VALUES (?, 'bet', ?, ?, 'cancelled', NULL, NULL, NULL, ?, ?)`)
        .run(refTransactionId, playerId, roundId, now(), now());
    } else if (bet.operation === 'bet' && bet.status === 'completed') {
      const entry = db.prepare('SELECT amount FROM ledger_entries WHERE transaction_id = ?').get(refTransactionId);
      amount = entry?.amount ?? 0;
      changeWallet(db, playerId, amount, 0);
      db.prepare("UPDATE ledger_entries SET status = 'refunded' WHERE transaction_id = ?").run(refTransactionId);
      db.prepare("UPDATE provider_transactions SET status = 'cancelled', updated_at = ? WHERE transaction_id = ?")
        .run(now(), refTransactionId);
    }
    addLedgerEntry(db, { playerId, transactionId, kind: 'refund', amount, balanceDelta: amount, frozenDelta: 0, roundId, refTransactionId });
    recordProviderTransaction(db, { transactionId, operation: 'refund', playerId, roundId, refTransactionId });
    return { idempotent: false, ...getWallet(db, playerId) };
  });
}

/** One admin action in admin_audit_logs. Call inside the transaction that does the action. */
export function writeAuditLog(db, { adminId, action, targetType = null, targetId = null, reason = null, details = null }) {
  db.prepare(`INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, reason, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id(), adminId, action, targetType, targetId, reason, details ? JSON.stringify(details) : null, now());
}

function requireReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new LedgerError('REASON_REQUIRED', '必须填写原因');
  if (text.length > 200) throw new LedgerError('REASON_TOO_LONG', '原因最多 200 个字');
  return text;
}

/**
 * Admin adds (amount > 0) or removes (amount < 0) available credits. The wallet
 * change, the ledger entry and the audit log are written in one transaction.
 */
export function manualAdjustment(db, { adminId, playerId, amount, reason }) {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new LedgerError('INVALID_AMOUNT', '调整金额必须是非零整数');
  const text = requireReason(reason);
  return inTransaction(db, () => {
    wallet(db, playerId);
    const transactionId = `manual-adjustment:${id()}`;
    changeWallet(db, playerId, amount, 0);
    addLedgerEntry(db, { playerId, transactionId, kind: 'manual_adjustment', amount: Math.abs(amount), balanceDelta: amount, frozenDelta: 0, reason: text });
    const after = getWallet(db, playerId);
    writeAuditLog(db, { adminId, action: 'adjust_balance', targetType: 'player', targetId: playerId, reason: text, details: { amount, transactionId, balanceAfter: after.balance } });
    return { transactionId, ...after };
  });
}

/** Freeze or unfreeze a player account, with an audit log in the same transaction. */
export function setPlayerStatus(db, { adminId, playerId, status, reason }) {
  if (!['active', 'frozen'].includes(status)) throw new LedgerError('INVALID_STATUS', '状态无效');
  const text = typeof reason === 'string' && reason.trim() ? requireReason(reason) : null;
  return inTransaction(db, () => {
    const player = db.prepare('SELECT status FROM players WHERE id = ?').get(playerId);
    if (!player) throw new LedgerError('PLAYER_NOT_FOUND', '玩家不存在');
    db.prepare('UPDATE players SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), playerId);
    writeAuditLog(db, { adminId, action: status === 'frozen' ? 'freeze_player' : 'unfreeze_player', targetType: 'player', targetId: playerId, reason: text, details: { from: player.status, to: status } });
    return { id: playerId, status };
  });
}

export function reconcilePlayer(db, playerId) {
  const actual = getWallet(db, playerId);
  const totals = db.prepare(`SELECT COALESCE(SUM(balance_delta), 0) AS balance, COALESCE(SUM(frozen_delta), 0) AS frozen
    FROM ledger_entries WHERE player_id = ?`).get(playerId);
  const ledger = { balance: totals.balance, frozenBalance: totals.frozen };
  return { actual, ledger,
    balanceMatches: actual.balance === ledger.balance, frozenMatches: actual.frozen_balance === ledger.frozenBalance,
    totalMatches: actual.balance + actual.frozen_balance === ledger.balance + ledger.frozenBalance };
}
