import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { openPlatformDatabase } from '../../server/platform/db.mjs';
import { LedgerError, approveDeposit, approveWithdrawal, createDepositRequest, createPlayer, createWithdrawalRequest, getWallet, placeBet, reconcilePlayer } from '../../server/platform/ledger.mjs';

const tempDirectories: string[] = [];

function testDatabase() {
  const directory = mkdtempSync(join(process.cwd(), '.platform-test-'));
  tempDirectories.push(directory);
  return openPlatformDatabase(join(directory, 'platform.sqlite'));
}

afterEach(() => {
  while (tempDirectories.length) rmSync(tempDirectories.pop()!, { recursive: true, force: true });
});

function fundedPlayer(db: ReturnType<typeof openPlatformDatabase>, amount = 100) {
  const player = createPlayer(db, { username: `player-${Math.random()}` });
  createDepositRequest(db, { playerId: player.id, requestNo: `deposit-${player.id}`, amount });
  approveDeposit(db, { requestNo: `deposit-${player.id}` });
  return player;
}

describe('平台账本', () => {
  it('余额不足时不产生负数或半笔流水', () => {
    const db = testDatabase();
    const player = fundedPlayer(db, 100);
    assert.throws(() => placeBet(db, { playerId: player.id, transactionId: 'bet-too-large', amount: 101 }),
      (error: unknown) => error instanceof LedgerError && error.code === 'INSUFFICIENT_FUNDS');
    assert.deepEqual(getWallet(db, player.id), { balance: 100, frozen_balance: 0 });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE transaction_id = 'bet-too-large'").get().count, 0);
    db.close();
  });

  it('提现冻结的积分不能用于下注', () => {
    const db = testDatabase();
    const player = fundedPlayer(db, 100);
    createWithdrawalRequest(db, { playerId: player.id, requestNo: 'withdraw-1', amount: 80 });
    assert.deepEqual(getWallet(db, player.id), { balance: 20, frozen_balance: 80 });
    assert.throws(() => placeBet(db, { playerId: player.id, transactionId: 'bet-frozen', amount: 21 }), LedgerError);
    assert.deepEqual(getWallet(db, player.id), { balance: 20, frozen_balance: 80 });
    db.close();
  });

  it('相同供应商交易号只扣款一次', () => {
    const db = testDatabase();
    const player = fundedPlayer(db, 100);
    assert.equal(placeBet(db, { playerId: player.id, transactionId: 'round-1-bet', amount: 25 }).idempotent, false);
    assert.equal(placeBet(db, { playerId: player.id, transactionId: 'round-1-bet', amount: 25 }).idempotent, true);
    assert.equal(getWallet(db, player.id).balance, 75);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE transaction_id = 'round-1-bet'").get().count, 1);
    db.close();
  });

  it('同一提现申请只能通过一次', () => {
    const db = testDatabase();
    const player = fundedPlayer(db, 100);
    createWithdrawalRequest(db, { playerId: player.id, requestNo: 'withdraw-once', amount: 40 });
    approveWithdrawal(db, { requestNo: 'withdraw-once' });
    assert.throws(() => approveWithdrawal(db, { requestNo: 'withdraw-once' }),
      (error: unknown) => error instanceof LedgerError && error.code === 'REQUEST_NOT_PENDING');
    assert.deepEqual(getWallet(db, player.id), { balance: 60, frozen_balance: 0 });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE kind = 'withdrawal_approved'").get().count, 1);
    db.close();
  });

  it('钱包余额、冻结额和成功流水的对账公式一致', () => {
    const db = testDatabase();
    const player = fundedPlayer(db, 100);
    placeBet(db, { playerId: player.id, transactionId: 'round-2-bet', amount: 30, roundId: 'round-2' });
    createWithdrawalRequest(db, { playerId: player.id, requestNo: 'withdraw-pending', amount: 20 });
    const report = reconcilePlayer(db, player.id);
    assert.deepEqual(report.actual, { balance: 50, frozen_balance: 20 });
    assert.deepEqual(report.ledger, { balance: 50, frozenBalance: 20 });
    assert.equal(report.balanceMatches && report.frozenMatches && report.totalMatches, true);
    db.close();
  });
});
