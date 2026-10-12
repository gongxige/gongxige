// HTML page that shows one recorded round: the grid, wild multipliers, wins
// and money movements, and whether recomputing it from the stored stops gives
// the same result. Customer support and the operator open it by round ID.

import { ENGINE_VERSION, replaySpin } from '../src/engine/index.ts';
import { mathConfigForVersion, replaySpin as replayMahjongSpin } from '../src/mahjong/engine/index.ts';
import { replayRound as replayRabbitRound, BOARD_HEIGHTS as RABBIT_BOARD_HEIGHTS } from '../src/rabbit/engine/index.ts';
import { escapeHtml } from './http.mjs';

const NAMES = { bull: '水牛', lion: '狮子', elephant: '大象', zebra: '斑马', deer: '羚羊', coin: '金币', wild: '百搭' };
const name = (id) => NAMES[id] ?? id;
const fmt = (n) => Number(n).toLocaleString('zh-CN');

export function replayPage(round, imageBase) {
  if (round?.gameId === 'mahjong-cascade') return mahjongReplayPage(round);
  if (round?.gameId === 'jade-rabbit') return jadeRabbitReplayPage(round);
  if (!round) return page('找不到这一局', '<p class="lead">没有这个局号的开奖记录。如果平台流水里这一局只有"扣款 + 回滚"，说明扣款没有及时确认，这一局在开奖前就取消了。</p>');

  let check;
  let outcome = null;
  try {
    outcome = replaySpin({ bet: round.bet, mode: round.mode, stops: round.stops, multipliers: round.multipliers }, round.maxWinMultiplier ?? Infinity);
    const same = outcome.payout === round.payout && outcome.freeSpinsAwarded === round.freeSpinsAwarded;
    check = round.engineVersion !== ENGINE_VERSION
      ? `<p class="warn">⚠ 这一局用的是旧规则（${escapeHtml(round.engineVersion)}），现在是 ${ENGINE_VERSION}，下面是按现在的规则重算的，可能和当时不同。</p>`
      : same ? '<p class="ok">✓ 按记录的停点重新计算，结果与当时完全一致。</p>'
        : `<p class="bad">✗ 重新计算的赢分 ${fmt(outcome.payout)} 与记录的 ${fmt(round.payout)} 不一致！</p>`;
  } catch (error) {
    check = `<p class="bad">✗ 记录无法重现：${escapeHtml(error.message)}</p>`;
  }

  const winning = new Set(outcome ? outcome.wins.flatMap((w) => w.cells.map((c) => `${c.reel}-${c.row}`)) : []);
  const grid = outcome ? `<div class="grid">${[0, 1, 2, 3].map((row) => outcome.grid.map((column, reel) => {
    const id = column[row];
    const m = outcome.multipliers[reel][row];
    return `<div class="cell ${winning.has(`${reel}-${row}`) ? 'win' : ''}"><img src="${imageBase}/reels/${encodeURIComponent(id)}.png" alt="${escapeHtml(name(id))}">${m > 1 ? `<b>×${m}</b>` : ''}</div>`;
  }).join('')).join('')}</div>` : '';

  const wins = outcome && outcome.wins.length
    ? `<ul>${outcome.wins.map((w) => w.kind === 'scatter'
      ? `<li>${name(w.symbol)} × ${w.count} 个 = <b>${fmt(w.payout)}</b></li>`
      : `<li>${name(w.symbol)} ${w.reelCount} 连 × ${w.ways} 路${w.multipliedWays !== w.ways ? `（百搭加倍后 ${w.multipliedWays} 路）` : ''} = <b>${fmt(w.payout)}</b></li>`).join('')}</ul>`
    : '<p>本局没有中奖。</p>';

  const rows = [
    ['局号', escapeHtml(round.roundId)],
    ['时间', escapeHtml(round.at)],
    ['平台 / 玩家', `${escapeHtml(round.operatorId)} / ${escapeHtml(round.playerId)}`],
    ['类型', round.mode === 'free' ? `免费游戏（由 ${escapeHtml(round.parentRoundId ?? '?')} 触发）` : '付费旋转'],
    ['投注', round.mode === 'free' ? `${fmt(round.bet)}（免费，不扣款）` : fmt(round.bet)],
    ['赢分', `${fmt(round.payout)}${round.capped ? '（已达最大赢分上限）' : ''}`],
    ['获得免费游戏', round.freeSpinsAwarded ? `${round.freeSpinsAwarded} 局` : '—'],
    ['停点', round.stops.join(', ')],
    ['扣款交易', round.betTransactionId ? escapeHtml(round.betTransactionId) : '—'],
    ['派彩交易', escapeHtml(round.winTransactionId)],
    ['派彩状态', round.status === 'settled' ? `已到账（${escapeHtml(round.settledAt ?? '')}）` : '<span class="bad">待派彩（游戏服务器会自动重试）</span>'],
    ['规则版本', escapeHtml(round.engineVersion)],
  ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

  return page(`回放 ${round.roundId}`, `${check}<div class="layout">${grid}<div><h2>中奖</h2>${wins}</div></div><h2>记录</h2><table>${rows}</table>`);
}

function jadeRabbitReplayPage(round) {
  try {
    const replayed = replayRabbitRound(round.replayInput);
    const relatedPayout = replayed.paidSpin.payout + replayed.modeSpins.reduce((sum, spin) => sum + spin.payout, 0);
    const segment = round.mode === 'free' ? replayed.modeSpins[round.modeIndex] : replayed.paidSpin;
    const same = Boolean(segment) && segment.payout === round.payout && JSON.stringify(segment.stops) === JSON.stringify(round.stops)
      && relatedPayout === replayed.totalWin && round.engineVersion === round.replayInput.engineVersion;
    const board = (value) => `<div class="rabbit-board">${value.map((column, x) => `<div class="rabbit-column rows-${RABBIT_BOARD_HEIGHTS[x]}">${column.map((entry) => `<i>${escapeHtml(entry.symbolId)}${entry.bonusTier === undefined ? '' : ` · 档位 ${entry.bonusTier}`}</i>`).join('')}</div>`).join('')}</div>`;
    const lineWins = (segment?.lineWins ?? []).map((win) => `<li>第 ${win.lineNumber} 条：${escapeHtml(win.symbolId)} × ${win.multiplier} = <b>${fmt(win.payout)}</b></li>`).join('') || '<li>本局没有线奖。</li>';
    const bonusWins = (segment?.bonusWins ?? []).map((win) => `<li>奖金牌档位 ${win.tier} × ${win.multiplier} = <b>${fmt(win.value)}</b></li>`).join('') || '<li>本局没有奖金牌。</li>';
    return page(`玉兔送财回放 ${round.roundId}`, `<p class="${same ? 'ok' : 'bad'}">${same ? '✓ 按记录停点、版本和玉兔模式结果重算，结果完全一致。' : '✗ 回放与记录不一致或规则版本不可用。'}</p><p>局号：${escapeHtml(round.roundId)} · ${round.mode === 'free' ? `财富旋转第 ${Number(round.modeIndex) + 1} 次` : '付费旋转'} · 投注 ${fmt(round.bet)} · 派彩 ${fmt(round.payout)}</p><h2>盘面</h2>${board(segment?.board ?? [])}<h2>线奖</h2><ul>${lineWins}</ul><h2>奖金牌</h2><ul>${bonusWins}</ul><p>本次完整玉兔模式总赢分：${fmt(replayed.totalWin)}；${replayed.triggered ? `共 ${replayed.modeSpins.length} 次财富旋转。` : '未触发财富旋转。'}</p>`);
  } catch (error) {
    return page('玉兔送财回放', `<p class="bad">✗ 记录无法重现：${escapeHtml(error.message)}</p>`);
  }
}

function mahjongReplayPage(round) {
  try {
    const config = mathConfigForVersion(round.mathConfigVersion);
    const outcome = replayMahjongSpin({ ...round.replayInput, mathConfigVersion: round.mathConfigVersion });
    const same = outcome.payout === round.payout && JSON.stringify(outcome.cascadeSteps) === JSON.stringify(round.cascadeSteps)
      && round.engineVersion === 'mahjong-engine-1.2.0' && round.mathConfigVersion === config.version && round.stripRevision === config.stripRevision;
    const board = (value) => `<div class="mahjong-board">${value.map((column) => `<div>${column.map((tile) => `<i>${escapeHtml(tile.symbolId)}${tile.golden ? ' 金' : ''}</i>`).join('')}</div>`).join('')}</div>`;
    const steps = outcome.cascadeSteps.map((step, index) => `<article><h3>第 ${index + 1} 段消除连锁</h3>${board(step.beforeBoard)}<p>倍数 ×${step.cascadeMultiplier}；候选 ${fmt(step.candidatePayout)}；派彩 ${fmt(step.payout)}${step.capped ? '（封顶）' : ''}</p><p>金色变百搭：${step.goldenTransforms.length} 张；消除：${step.removed.length} 张；补牌：${step.refills.flat().length} 张</p>${board(step.afterBoard)}</article>`).join('') || '<p>本次无消除连锁。</p>';
    return page('麻将连连胡回放', `<p class="${same ? 'ok' : 'bad'}">${same ? '✓ 按记录停点、版本及每一步连锁重算，结果完全一致。' : '✗ 回放与记录不一致或规则版本不可用。'}</p><p>局号：${escapeHtml(round.roundId)} · ${round.mode === 'free' ? '免费旋转' : '付费旋转'} · 投注 ${fmt(round.bet)} · 派彩 ${fmt(round.payout)} · 胡 ${round.huCount}</p><h2>初始牌面</h2>${board(outcome.initialBoard)}<h2>连锁过程</h2>${steps}<h2>最终牌面</h2>${board(outcome.finalBoard)}`);
  } catch (error) { return page('麻将连连胡回放', `<p class="bad">✗ 记录无法重现：${escapeHtml(error.message)}</p>`); }
}

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
:root{--bg:#1a0d06;--panel:#2a1a10;--ink:#f6ead8;--muted:#c4ab8c;--line:#4a3322;--gold:#f4c55b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 48px}h1{font-size:20px;margin:0 0 12px;color:var(--gold)}h2{font-size:15px;margin:18px 0 8px}
.layout{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}.grid{display:grid;grid-template-columns:repeat(5,min(96px,17vw));gap:6px;padding:8px;background:#0e0703;border:3px solid var(--gold);border-radius:12px}
.cell{position:relative;aspect-ratio:1;background:#f6ecd6;border-radius:6px;display:flex;align-items:center;justify-content:center;opacity:.45}
.grid:not(:has(.win)) .cell,.cell.win{opacity:1}.cell.win{box-shadow:0 0 0 3px var(--gold),0 0 14px rgba(244,197,91,.7)}.cell img{width:92%;height:92%;object-fit:contain}
.cell b{position:absolute;right:4px;bottom:4px;background:#c4001f;color:#fff;border-radius:6px;padding:0 5px;font-size:12px}
table{border-collapse:collapse;width:100%;background:var(--panel);border-radius:10px;overflow:hidden}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;width:130px}.rabbit-board{display:flex;gap:8px;align-items:stretch;max-width:640px;padding:10px;background:#3b160d;border:3px solid var(--gold);border-radius:12px}.rabbit-column{display:grid;flex:1;gap:6px}.rabbit-column i{display:grid;place-items:center;min-height:58px;padding:5px;background:#f6ecd6;color:#4b2413;border-radius:7px;font-style:normal;font-weight:700;text-align:center}
.ok{color:#7be3a2}.bad{color:#ff8a80;font-weight:600}.warn{color:#ffd27a}.lead{color:var(--muted)}ul{margin:0;padding-left:18px}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}
