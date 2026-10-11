// Permanent round log. Every round is one JSON line in an append-only file
// (data/*.rounds.jsonl), plus a "settled" line once its win reaches the
// operator. Lines are never rewritten, so the history cannot be quietly
// changed; the file is read back into memory at start-up for lookups.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function openRoundLog(path) {
  const rounds = new Map();
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { apply(JSON.parse(line)); } catch { /* skip a torn last line */ }
    }
  }

  function apply(entry) {
    if (entry.type === 'round') rounds.set(entry.roundId, { ...entry });
    else if (entry.type === 'settled' && rounds.has(entry.roundId)) Object.assign(rounds.get(entry.roundId), { status: 'settled', settledAt: entry.at, balanceAfter: entry.balanceAfter });
  }

  function append(entry) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
    apply(entry);
  }

  return {
    get: (roundId) => rounds.get(roundId),
    add: (round) => append({ type: 'round', ...round }),
    settle: (roundId, balanceAfter) => append({ type: 'settled', roundId, at: new Date().toISOString(), balanceAfter }),
    /** Most recent rounds first, optionally for one player. */
    list: (filter = () => true, limit = 50) => [...rounds.values()].filter(filter).slice(-limit).reverse(),
  };
}
