import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  BOARD_HEIGHTS,
  BONUS_MULTIPLIERS,
  MATH_MODE_STRIPS,
  MATH_STRIPS,
  MATH_CONFIG_VERSION,
  MAX_WIN_MULTIPLIER,
  MODE_SPINS,
  PAYLINES,
  PAYTABLE,
  type Board,
  type BonusTier,
  type LineSymbolId,
  type SymbolId,
  type Token,
} from './engine/index.ts';
import { cellCenter, rectToPercent, type ArtLayout } from './artLayout.ts';
import { BIG_WIN, bigWinLabel, bigWinTier, countUpValue, lineBadges, MODE_FLOW_MS, WIN_TIMING, winningCells } from './winDisplay.ts';
import { markLocalArtFailed, preloadLocalArt, useLocalArt } from './localArt.ts';
import { openingBoard } from './openingBoard.ts';
import { markLocalSymbolFailed, preloadLocalSymbols, useLocalSymbolSrc } from './localSymbolImages.ts';
import { COLUMN_DECEL_STARTS, COLUMN_DECEL_STARTS_FAST, COLUMN_START_DELAYS, MIN_COLUMN_GAP, MIN_COLUMN_GAP_FAST, ReelMotion } from './reelMotion.ts';

type FreeSpins = { bet: number; remaining: number; played: number; totalWin: number; parentRoundId?: string } | null;
type Session = { playerName: string; gameId: string; allowedBets?: number[]; credits: number; freeSpins: FreeSpins };
type SpinResult = {
  gameId: string;
  engineVersion?: string;
  roundId: string;
  parentRoundId: string | null;
  mode: 'paid' | 'free';
  bet: number;
  grid: Board;
  lineWins?: readonly { lineNumber: number; symbolId: SymbolId; payout: number; coordinates: readonly [{ x: 0 | 1 | 2; y: number }, { x: 0 | 1 | 2; y: number }, { x: 0 | 1 | 2; y: number }] }[];
  bonusWins?: readonly { coordinates: { x: 0 | 1 | 2; y: number }; value: number; tier: BonusTier }[];
  payout: number;
  roundTotalWin: number;
  triggered: boolean;
  capped: boolean;
  credits: number | null;
  settlementPending?: boolean;
  freeSpinsAwarded: number;
  freeSpins: FreeSpins;
  freeSpinsFinished: { played: number; totalWin: number } | null;
  modeIndex?: number;
};

/** 谁发起的旋转：玩家点击/空格、自动旋转、玉兔模式自己接着转。 */
type SpinKind = 'manual' | 'auto' | 'mode';

type RabbitPresentation = 'idle' | 'bonus-collect' | 'big-win' | 'trigger-wins' | 'mode-trigger' | 'mode-intro' | 'mode-flash' | 'mode-spin' | 'mode-collect' | 'mode-finale' | 'mode-total';

const token = new URLSearchParams(location.search).get('token') ?? '';
const fmt = (value: number) => value.toLocaleString('zh-CN');
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const EMPTY_TOKEN: Token = { symbolId: 'BLANK', stackGroupId: 'empty' };
/** 这些画面在播放叠加动画，期间不接受新的旋转（按钮、空格、自动都一样）。 */
const LOCKED_PRESENTATIONS: ReadonlySet<string> = new Set(['bonus-collect', 'big-win', 'trigger-wins', 'mode-trigger', 'mode-intro', 'mode-flash', 'mode-collect', 'mode-finale', 'mode-total']);

/** 规则页列出的牌匾档位直接取自正式轴带，避免列出实际不会出现的档位。 */
const tiersOf = (strips: readonly (readonly Token[])[]) => [...new Set(strips.flat().filter((entry) => entry.symbolId === 'BONUS_PLATE').map((entry) => BONUS_MULTIPLIERS[entry.bonusTier ?? 0]))].sort((a, b) => a - b);
const MAIN_TIERS = tiersOf(MATH_STRIPS);
const MODE_TIERS = tiersOf(MATH_MODE_STRIPS);
const fmtTiers = (tiers: readonly number[]) => tiers.map((tier) => `×${tier}`).join('、');

const PAYTABLE_LABELS: Record<string, string> = {
  WILD: '百搭', YUANBAO: '元宝', FU_BAG: '福袋', RED_ENVELOPE: '红包',
  COPPER_COIN: '铜钱', FIRECRACKER: '鞭炮', CARROT: '胡萝卜',
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '游戏服务器暂时无法连接'), { status: response.status, code: data.code });
  return data as T;
}

function RabbitMascot({ mood }: { mood: 'idle' | 'spin' | 'win' | 'mode' | 'trigger' | 'finale' }) {
  return <svg className={`rabbit-mascot rabbit-mascot-${mood}`} viewBox="0 0 140 116" role="img" aria-label="原创云耳玉兔吉祥物">
    <path className="rabbit-ear" d="M48 42C21 27 22 3 38 4c15 1 25 18 24 38z" />
    <path className="rabbit-ear rabbit-ear-back" d="M91 37c22-17 39-8 35 6-4 14-21 21-37 18z" />
    <ellipse className="rabbit-body" cx="70" cy="77" rx="42" ry="31" />
    <circle className="rabbit-head" cx="70" cy="50" r="31" />
    <circle className="rabbit-eye" cx="59" cy="48" r="3.2" /><circle className="rabbit-eye" cx="81" cy="48" r="3.2" />
    <path className="rabbit-smile" d="M63 61q7 7 14 0" />
    <path className="rabbit-cheek" d="M44 58h9M87 58h9" />
    <ellipse className="rabbit-jade" cx="70" cy="78" rx="11" ry="14" />
    <path className="rabbit-jade-mark" d="M66 78q4-7 8 0t-8 0z" />
    <path className="rabbit-tail" d="M111 78q25-17 22 7-3 17-25 10" />
    <path className="rabbit-foot" d="M43 100q-10 12-20 4M96 100q10 12 20 4" />
  </svg>;
}

function RabbitSymbol({ entry, bet }: { entry: Token; bet: number }) {
  const id = entry.symbolId;
  const localSrc = useLocalSymbolSrc(id);
  const art = useLocalArt();
  if (id === 'BONUS_PLATE') {
    const tier = entry.bonusTier ?? 0;
    const value = Math.round(BONUS_MULTIPLIERS[tier] * bet);
    // 本机牌匾底图：数值写在牌匾中间，×20 及以上的大数值用粉紫色字。
    if (art.bonusPlate) return <span className={`rabbit-symbol rabbit-plate-image ${BONUS_MULTIPLIERS[tier] >= 20 ? 'is-big' : ''}`} role="img" aria-label={`奖金牌匾 ${value}`}>
      <img src={art.bonusPlate} alt="" draggable={false} onError={() => markLocalArtFailed('bonusPlate')} />
      <b>{fmt(value)}</b>
    </span>;
    return <svg className="rabbit-symbol rabbit-bonus-symbol" viewBox="0 0 120 88" aria-label={`奖金牌匾 ${value}`}>
      <path className="bonus-ribbon" d="M10 18 18 9h84l8 9v52l-8 9H18l-8-9z" />
      <path className="bonus-rim" d="M16 21 22 15h76l6 6v46l-6 6H22l-6-6z" />
      <circle cx="24" cy="26" r="4" /><circle cx="96" cy="26" r="4" /><circle cx="24" cy="62" r="4" /><circle cx="96" cy="62" r="4" />
      <text x="60" y="45" className="bonus-multiplier" textAnchor="middle">×{BONUS_MULTIPLIERS[tier]}</text>
      <text x="60" y="63" className="bonus-value" textAnchor="middle">{fmt(value)}</text>
    </svg>;
  }
  if (id === 'BLANK' && art.knotTile) return <img className="rabbit-symbol rabbit-symbol-image rabbit-knot-image" src={art.knotTile} alt="空白格" draggable={false} onError={() => markLocalArtFailed('knotTile')} />;
  if (id === 'BLANK') return <svg className="rabbit-symbol" viewBox="0 0 120 88" aria-label="空白格"><path className="blank-knot" d="M60 17c-17 0-25 15-9 22-16 7-8 22 9 22s25-15 9-22c16-7 8-22-9-22zM60 61v13M52 70h16" /></svg>;
  if (localSrc) return <img className={`rabbit-symbol rabbit-symbol-image symbol-${id.toLowerCase()}`} src={localSrc} alt={PAYTABLE_LABELS[id] ?? id} draggable={false} onError={() => markLocalSymbolFailed(id)} />;
  return <svg className={`rabbit-symbol symbol-${id.toLowerCase()}`} viewBox="0 0 120 88" aria-label={PAYTABLE_LABELS[id] ?? id}>
    {id === 'WILD' && <><path className="wild-cloud" d="M24 55c-10-15 4-28 18-24 3-19 31-22 39-4 19-6 34 14 22 28-6 7-17 9-28 8H40c-8 0-13-3-16-8z" /><path className="wild-swirl" d="M50 44q21-15 23 4-1 14-19 7" /></>}
    {id === 'YUANBAO' && <><path className="yuanbao" d="M22 38c5-13 18-20 38-20s33 7 38 20l-9 27c-11 10-47 10-58 0z" /><path className="yuanbao-top" d="M30 38q30 12 60 0l-5-11H35z" /><circle cx="50" cy="36" r="3" /><circle cx="70" cy="36" r="3" /></>}
    {id === 'FU_BAG' && <><path className="fu-bag" d="M34 27q26 9 52 0l7 42q-33 14-66 0z" /><path className="fu-tie" d="M42 28q18 10 36 0M48 20q12 13 24 0" /><path className="fu-mark" d="M54 49h12v12H54z" /></>}
    {id === 'RED_ENVELOPE' && <><path className="red-envelope" d="m20 27 40-13 40 13-6 40H26z" /><path className="red-fold" d="m20 27 40 22 40-22" /><circle className="red-jade" cx="60" cy="45" r="10" /><path d="M55 45h10M60 40v10" className="red-jade-mark" /></>}
    {id === 'COPPER_COIN' && <><circle className="copper-coin" cx="60" cy="44" r="31" /><rect className="copper-hole" x="51" y="35" width="18" height="18" rx="2" /><path className="coin-stroke" d="M38 25l8 6M82 25l-8 6M38 63l8-6M82 63l-8-6" /></>}
    {id === 'FIRECRACKER' && <><path className="firecracker" d="M28 29h18v35H28zM51 22h18v42H51zM74 29h18v35H74z" /><path className="fire-line" d="M60 22q-4-12 8-17" /><circle className="spark" cx="70" cy="8" r="3" /><circle className="spark" cx="82" cy="13" r="2" /></>}
    {id === 'CARROT' && <><path className="carrot-leaf" d="M60 35q-3-21-17-24 16-3 22 13 7-17 21-12-16 10-17 25z" /><path className="carrot" d="M60 27q27 3 28 18-1 23-28 35-27-12-28-35 1-15 28-18z" /><path className="carrot-line" d="M47 51q12 6 26 0M51 61q9 4 18 0" /></>}
  </svg>;
}

/** 规则里赔付表符号的排列：百搭单独一行，其余三个一行（和参考游戏的赔付表排法一致）。 */
const PAYTABLE_ROWS: readonly (readonly (LineSymbolId | 'WILD')[])[] = [
  ['WILD'],
  ['YUANBAO', 'FU_BAG', 'RED_ENVELOPE'],
  ['COPPER_COIN', 'FIRECRACKER', 'CARROT'],
];

function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rabbit-rule-section"><h3>{title}</h3>{children}</section>;
}

/**
 * 规则与赔付表（STEP-51）：结构参考用户给的参考游戏规则页——介绍、符号赔付值、奖金符号、玉兔模式、最高赢奖倍数、
 * 中奖线、按钮说明、附加信息。所有数值直接取自引擎（1.3.0），只写本游戏真实有的功能。
 */
function RulesModal({ bet, bets, onClose }: { bet: number; bets: readonly number[]; onClose: () => void }) {
  const betRange = bets.length ? `${fmt(bets[0])}～${fmt(bets[bets.length - 1])}` : fmt(bet);
  const allTiers = [...new Set([...MAIN_TIERS, ...MODE_TIERS])].sort((a, b) => a - b);
  return <div className="rabbit-modal-backdrop" role="dialog" aria-modal="true" aria-label="玉兔送财规则与赔付表">
    <section className="rabbit-modal rabbit-rules">
      <div className="rabbit-modal-heading"><span>玉兔送财</span><button type="button" onClick={onClose} aria-label="关闭规则">×</button></div>

      <RuleSection title="游戏规则">
        <ul>
          <li>玉兔送财是一个 3 轴（第 1、3 轴 3 行，第 2 轴 4 行）的老虎机游戏，奖金符号最高可达总投注的 {fmt(allTiers[allTiers.length - 1])} 倍。</li>
          <li>游戏共有 {PAYLINES.length} 条固定中奖线。{bets.length ? <>总投注可选 {betRange} 虚拟积分（{bets.map(fmt).join(' / ')}），</> : null}每线投注 = 总投注 ÷ {PAYLINES.length}。</li>
          <li>总投注用画面下方的「−」「+」和「最大投注」设定；「余额」显示平台钱包里可用的虚拟积分。</li>
          <li>「自动旋转」可以按选择的次数自动进行游戏。</li>
          <li>中奖组合和奖金按「赔付表」派发：一条中奖线的奖金 = 赔付表上的倍数 × 每线投注。</li>
          <li>每条中奖线只支付最高的一个奖；中奖线从最左边的卷轴开始，三轴连成才算中奖。</li>
          <li>不同中奖线上的奖金会叠加。</li>
          <li>所有赢分都以虚拟积分显示。</li>
          <li>百搭符号可替代除奖金符号外的所有符号。</li>
        </ul>
      </RuleSection>

      <RuleSection title="符号赔付值">
        <div className="rabbit-paytable">
          {PAYTABLE_ROWS.map((row, index) => <div className="rabbit-paytable-row" key={index}>{row.map((id) => <div className="rabbit-paytable-item" key={id}>
            <RabbitSymbol entry={{ symbolId: id, stackGroupId: `rules-${id}` }} bet={bet} />
            <span>{PAYTABLE_LABELS[id]}</span>
            <strong>{PAYTABLE[id]}</strong>
            <small>= {fmt(Math.round(PAYTABLE[id] * bet / PAYLINES.length))}</small>
          </div>)}</div>)}
        </div>
        <ul>
          <li>上面的数字是三连时的「每线投注」倍数；「=」后是按当前总投注 {fmt(bet)} 计算的金额。</li>
          <li>百搭符号可替代除奖金符号外的所有符号。</li>
        </ul>
      </RuleSection>

      <RuleSection title="奖金符号">
        <div className="rabbit-rule-plates">{[MAIN_TIERS[0], MAIN_TIERS[3], MODE_TIERS[MODE_TIERS.length - 1]].map((multiplier) => {
          const tier = BONUS_MULTIPLIERS.indexOf(multiplier as typeof BONUS_MULTIPLIERS[number]) as BonusTier;
          return <div className="rabbit-rule-plate" key={multiplier}><RabbitSymbol entry={{ symbolId: 'BONUS_PLATE', bonusTier: tier, stackGroupId: `rules-plate-${tier}` }} bet={bet} /></div>;
        })}</div>
        <ul>
          <li>在任何旋转中，卷轴上都可能出现一个或多个奖金符号。</li>
          <li>每个奖金符号的价值为总投注的 {fmt(allTiers[0])} 倍至 {fmt(allTiers[allTiers.length - 1])} 倍不等：主游戏可能出现 {fmtTiers(MAIN_TIERS)}，财富旋转中可能出现 {fmtTiers(MODE_TIERS)}。</li>
          <li>当 5 个或更多奖金符号出现在卷轴上的任意位置时，支付所有奖金符号的价值之和；不足 5 个不派彩。</li>
        </ul>
      </RuleSection>

      <RuleSection title="玉兔模式">
        <ul>
          <li>每次付费旋转都可能随机触发带 {MODE_SPINS} 次财富旋转的玉兔模式，与盘面上有没有奖金符号无关。</li>
          <li>玉兔模式期间，卷轴上只会出现奖金符号和空白格；财富旋转不扣投注，也不会再次触发玉兔模式。</li>
        </ul>
      </RuleSection>

      <RuleSection title="最高赢奖倍数">
        <ul>
          <li>最高赢分为总投注的 {fmt(MAX_WIN_MULTIPLIER)} 倍。</li>
          <li>若主游戏和玉兔模式的总赢分达到总投注的 {fmt(MAX_WIN_MULTIPLIER)} 倍，本轮立即结束，剩余的财富旋转不再进行。</li>
        </ul>
      </RuleSection>

      <RuleSection title="中奖线">
        <div className="rabbit-payline-grid">{PAYLINES.map((line, index) => <figure key={index} aria-label={`第 ${index + 1} 条中奖线`}>
          <figcaption>{String(index + 1).padStart(2, '0')}</figcaption>
          <svg viewBox="0 0 30 40" aria-hidden="true">{BOARD_HEIGHTS.map((rows, x) => Array.from({ length: rows }, (_, y) => {
            const on = line[x].x === x && line[x].y === y;
            return <rect key={`${x}-${y}`} className={on ? 'is-on' : ''} x={x * 10 + 1} y={(rows === 4 ? 0 : 5) + y * 10 + 1} width="8" height="8" rx="1.5" />;
          }))}</svg>
        </figure>)}</div>
        <ul>
          <li>只支付每条中奖线中赢取最高的奖金。</li>
          <li>中奖线奖金按照从最左至最右卷轴的顺序派发。</li>
          <li>不同中奖线上的奖金会被叠加。</li>
        </ul>
      </RuleSection>

      <RuleSection title="按钮说明">
        <dl className="rabbit-rule-buttons">
          <dt><span className="rule-icon is-spin">旋转</span></dt><dd>用当前总投注开始游戏；转动中再点一次（显示「立即停止」）可以马上停下，结果不变。</dd>
          <dt><span className="rule-icon">空格</span></dt><dd>仅限电脑：按一下空格键旋转；按住空格键会持续旋转，松开即停。</dd>
          <dt><span className="rule-icon">− / +</span></dt><dd>减少或增加总投注。</dd>
          <dt><span className="rule-icon">最大投注</span></dt><dd>把总投注设为最高档。</dd>
          <dt><span className="rule-icon">自动旋转</span></dt><dd>先在「自动」里选次数（5 / 10 / 25 / 50），再点「自动旋转」；进行中按钮显示剩余次数，点它可以停止。余额不足、出错或触发玉兔模式时会自动停下。</dd>
          <dt><span className="rule-icon">极速</span></dt><dd>打开后缩短卷轴转动的时间，结果不变。</dd>
          <dt><span className="rule-icon">?</span></dt><dd>打开本页规则与赔付表。</dd>
          <dt><span className="rule-icon">⌂</span></dt><dd>返回平台大厅。</dd>
        </dl>
      </RuleSection>

      <RuleSection title="附加信息">
        <ul>
          <li>本游戏是演示平台，只使用虚拟积分，不涉及真实货币。</li>
          <li>每一局的结果都由游戏服务器决定并记录，画面只是展示；网络中断时以服务器记录为准，赢分会自动到账；没转完的财富旋转会在重新进入游戏后继续。</li>
          <li>每一局都有局号（画面最下方），可以在平台「游戏记录」里打开回放核对。当前规则版本：{MATH_CONFIG_VERSION}。</li>
          <li>本游戏没有声音和游戏内历史记录按钮；历史记录请到平台大厅的「游戏记录」查看。</li>
        </ul>
      </RuleSection>

      <button className="rabbit-primary" type="button" onClick={onClose}>知道了</button>
    </section>
  </div>;
}

/** STEP-54：触发财富旋转时卷轴还在转，两侧射出金光，盘面上方出现游戏标题大字（用本游戏自己的名字）。 */
function TriggerOverlay() {
  return <div className="rabbit-trigger" role="status" aria-label="触发财富旋转">
    <i className="rabbit-trigger-ray is-left" /><i className="rabbit-trigger-ray is-right" />
    <div className="rabbit-trigger-title"><b>玉兔送财</b><small>财富旋转</small></div>
  </div>;
}

/** STEP-54：「8 次财富旋转」红色卷轴横幅，两侧鞭炮，背景放烟花，吉祥物从横幅后面探出来。 */
function IntroBanner({ spins }: { spins: number }) {
  return <div className="rabbit-intro" role="status" aria-label={`${spins} 次财富旋转`}>
    {[0, 1, 2, 3, 4].map((index) => <i className={`rabbit-firework is-${index}`} key={index} />)}
    <div className="rabbit-intro-mascot"><RabbitMascot mood="trigger" /></div>
    <div className="rabbit-scroll">
      <i className="rabbit-scroll-roller is-top" /><i className="rabbit-scroll-roller is-bottom" />
      <b>{spins}</b><span>财富旋转</span>
    </div>
    <i className="rabbit-firecrackers is-left" /><i className="rabbit-firecrackers is-right" />
  </div>;
}

function CoinRain() {
  return <div className="rabbit-coin-rain" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <em key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${-(index * 0.23) % 1.6}s` }} />)}</div>;
}

/**
 * STEP-54：大奖画面。数字 3 秒从 0 滚到赢分，滚过 50 倍投注时「大奖」变成「巨奖」，停 2 秒后结束；
 * 点一下：还在滚就直接跳到最终数字，已经停住就马上结束。减少动态效果时直接显示最终数字。
 */
function BigWinOverlay({ amount, bet, delaySeconds, onDone }: { amount: number; bet: number; delaySeconds: number; onDone: () => void }) {
  const reduced = useMemo(prefersReducedMotion, []);
  const [shown, setShown] = useState(reduced ? amount : 0);
  const [settled, setSettled] = useState(reduced);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (settled) return;
    const startedAt = performance.now() + delaySeconds * 1000;
    // 用定时器而不是 requestAnimationFrame：标签页在后台时也会走完，不会卡住玉兔模式和自动旋转。
    const timer = window.setInterval(() => {
      const value = countUpValue(amount, (performance.now() - startedAt) / 1000);
      setShown(value);
      if (value >= amount) setSettled(true);
    }, 40);
    return () => window.clearInterval(timer);
  }, [settled, amount, delaySeconds]);
  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => doneRef.current(), BIG_WIN.holdSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [settled]);
  const skip = () => { if (settled) doneRef.current(); else { setShown(amount); setSettled(true); } };
  const label = bigWinLabel(shown, bet);
  return <div className={`rabbit-bigwin ${label === '巨奖' ? 'is-mega' : 'is-big'}`} style={{ animationDelay: `${delaySeconds}s` }} role="button" tabIndex={0} aria-label={`${label} ${fmt(amount)}，点击跳过`} onClick={skip} onKeyDown={(event) => { if (event.key === 'Enter') skip(); }}>
    <i className="rabbit-bigwin-rays" />
    <div className="rabbit-bigwin-mascot"><RabbitMascot mood="finale" /></div>
    <b className="rabbit-bigwin-label" key={label}>{label}</b>
    <strong className="rabbit-bigwin-amount">{fmt(shown)}</strong>
    <CoinRain />
    <small>点击跳过</small>
  </div>;
}

/** 每列的控制接口：开始转、停在结果上、立即结束。 */
type ReelHandle = {
  start(delaySeconds: number): void;
  land(result: readonly Token[], quick?: boolean): Promise<void>;
  snap(): void;
};

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 阶段 15 / STEP-52：逐帧控制位置的卷轴（参数见 reelMotion.ts）。
 * 只渲染视口里的 rows 格加上下各 1 格；位置跨过整数格时同步换一批格子，其余时间只改 transform。
 * 滚动内容依次是：转动前的盘面（origin 起的 rows 格）、真实轴带、服务器结果（停点 stopK 起的 rows 格）。
 * 滚动带一直在页面里（停着时隐藏，内容就是当前盘面）；下一局从上一局的停点接着转，起转时不新建元素。
 */
const SpinningReel = memo(function SpinningReel({ rows, bet, strip, rest, spinning, handleRef }: {
  rows: number;
  bet: number;
  strip: readonly Token[];
  rest: readonly Token[];
  spinning: boolean;
  handleRef: (handle: ReelHandle | null) => void;
}) {
  const [view, setView] = useState({ base: 0, spinId: 0, rev: 0, kickDelay: 0 });
  const trackRef = useRef<HTMLDivElement>(null);
  const motion = useMemo(() => new ReelMotion(rows), [rows]);
  const latest = useRef({ rest, strip });
  latest.current = { rest, strip };
  const data = useRef({ base: 0, origin: 0, running: false, startColumn: rest, strip, result: null as readonly Token[] | null, stopK: null as number | null, reduced: false });
  const frame = useRef(0);
  const landing = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  const tokenAt = (k: number): Token => {
    const d = data.current;
    if (d.result && d.stopK !== null && k >= d.stopK && k < d.stopK + rows) return d.result[k - d.stopK];
    // 停着时这一段跟着当前盘面走（例如进入玉兔模式换成空白盘面），起转时就和看到的一样。
    if (k >= d.origin && k < d.origin + rows) return (d.running ? d.startColumn : rest)[k - d.origin] ?? EMPTY_TOKEN;
    // 其余位置按真实轴带的顺序排；位置一局接一局往下走，所以每局滚过的是轴带上不同的一段。
    const length = d.strip.length;
    return d.strip[((k % length) + length) % length];
  };

  const placeTrack = (p: number, base: number) => {
    if (trackRef.current) trackRef.current.style.transform = `translate3d(0, ${(-(p - base + 1) / (rows + 2)) * 100}%, 0)`;
  };

  const finish = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const d = data.current;
    if (d.running && d.result && d.stopK !== null) {
      // 停稳后结果成为下一局的起点；内容和停点一样，不需要重新渲染。
      d.origin = d.stopK;
      d.startColumn = d.result;
    }
    d.running = false;
    d.result = null;
    d.stopK = null;
    const current = landing.current;
    landing.current = null;
    current?.resolve();
  };

  /** 直接停到结果上（标签页在后台、requestAnimationFrame 不走时用）。 */
  const jumpToResult = () => {
    const d = data.current;
    if (!d.result) return;
    motion.snap();
    // 停点放在当前视口下方够远的地方（看不见，也不会和起点那段重叠）。
    d.stopK = Math.floor(d.base) - rows - 2;
    const base = d.stopK;
    d.base = base;
    setView((value) => ({ ...value, base }));
    placeTrack(base, base);
    finish();
  };

  const tick = (nowMs: number) => {
    const d = data.current;
    const { p, phase } = motion.sample(nowMs / 1000);
    if (d.result && d.stopK === null && motion.target !== null) {
      // 停点定下来时结果还在视口上方，异步渲染就来得及。
      d.stopK = motion.target;
      setView((value) => ({ ...value, rev: value.rev + 1 }));
    }
    const base = Math.floor(p);
    if (base !== d.base) {
      d.base = base;
      // 换格子和改位置必须在同一帧生效，否则会跳一格。
      flushSync(() => setView((value) => ({ ...value, base })));
    }
    placeTrack(p, base);
    if (phase === 'done' || phase === 'idle') { finish(); return; }
    frame.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    handleRef({
      start(delaySeconds) {
        finish();
        const d = data.current;
        d.startColumn = latest.current.rest;
        d.strip = latest.current.strip;
        d.running = true;
        d.reduced = prefersReducedMotion();
        setView((value) => ({ ...value, spinId: value.spinId + 1, kickDelay: delaySeconds }));
        if (d.reduced) { motion.snap(); return; }
        motion.start(performance.now() / 1000, delaySeconds, d.origin);
        frame.current = requestAnimationFrame(tick);
      },
      land(result, quick = false) {
        const d = data.current;
        if (d.reduced || !motion.isActive) { motion.snap(); finish(); return Promise.resolve(); }
        if (landing.current) {
          if (quick) motion.requestStop(performance.now() / 1000, true);
          return landing.current.promise;
        }
        d.result = result;
        let resolve = () => {};
        const promise = new Promise<void>((done) => { resolve = done; });
        landing.current = { promise, resolve };
        if (document.hidden) { jumpToResult(); return promise; }
        motion.requestStop(performance.now() / 1000, quick);
        return promise;
      },
      snap() {
        motion.snap();
        const d = data.current;
        // 出错时回到起点，显示当前盘面。
        d.result = null;
        d.stopK = null;
        finish();
        d.base = d.origin;
        setView((value) => ({ ...value, base: d.origin }));
        placeTrack(d.origin, d.origin);
      },
    });
    // 停轴途中切到后台：后台里 requestAnimationFrame 会暂停，直接停到结果上，自动旋转和财富旋转不会卡住。
    const onHidden = () => { if (document.hidden && landing.current) jumpToResult(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => { handleRef(null); finish(); document.removeEventListener('visibilitychange', onHidden); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion]);

  const slots = Array.from({ length: rows + 2 }, (_, index) => view.base - 1 + index);
  return <>
    <div className="rabbit-reel-track" ref={trackRef} aria-hidden={!spinning} style={{ height: `${((rows + 2) / rows) * 100}%`, transform: `translate3d(0, ${(-1 / (rows + 2)) * 100}%, 0)` }}>
      {slots.map((k) => <div className="rabbit-cell" key={k} data-k={k}><RabbitSymbol entry={tokenAt(k)} bet={bet} /></div>)}
    </div>
    {spinning && <i className="rabbit-reel-kick" key={view.spinId} style={{ animationDelay: `${view.kickDelay}s` }} aria-hidden="true" />}
  </>;
});

export default function JadeRabbitApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [board, setBoard] = useState<Board>(() => openingBoard());
  const [spinningReels, setSpinningReels] = useState<boolean[]>([false, false, false]);
  const spinningRef = useRef<boolean[]>([false, false, false]);
  const reelHandles = useRef<(ReelHandle | null)[]>([null, null, null]);
  // 每列登记控制接口的回调保持不变，卷轴组件不会因此重新挂载。
  const reelHandleSetters = useMemo(() => BOARD_HEIGHTS.map((_, x) => (handle: ReelHandle | null) => { reelHandles.current[x] = handle; }), []);
  const [anticipating, setAnticipating] = useState(false);
  const [credits, setCredits] = useState(0);
  const [bet, setBet] = useState(0);
  const [win, setWin] = useState(0);
  const [message, setMessage] = useState('按“旋转”或空格键开始');
  const [error, setError] = useState('');
  const [rules, setRules] = useState(false);
  const [freeSpins, setFreeSpins] = useState<FreeSpins>(null);
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null);
  const [autoCount, setAutoCount] = useState('10');
  const [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [presentation, setPresentation] = useState<RabbitPresentation>('idle');
  const [modeTotalWin, setModeTotalWin] = useState(0);
  // 玉兔模式里已经有本局财富旋转的盘面（还没有时显示空白盘面）。
  const [modeBoardShown, setModeBoardShown] = useState(false);
  // 财富旋转请求失败后暂停自动接着转，等玩家点按钮继续。
  const [modePaused, setModePaused] = useState(false);
  const [lastRoundId, setLastRoundId] = useState('');
  const busyRef = useRef(false);
  const stopRequested = useRef(false);
  const autoRef = useRef(0);
  const spinRef = useRef<(kind?: SpinKind) => void>(() => {});
  // 服务器结果已到、还在播放停轴时的结果；「立即停止」只能停在这个结果上。
  const pendingResult = useRef<SpinResult | null>(null);
  const resultBonusWins = useRef<SpinResult['bonusWins']>([]);
  const bonusCollectNext = useRef<RabbitPresentation>('idle');
  // 最近一局付费旋转的盘面：玉兔模式结束后回到主游戏时恢复它，主游戏里不再留空白格。
  const mainBoardRef = useRef<Board | null>(null);
  const presentationRef = useRef(presentation);
  const spaceRepeatRef = useRef<number | null>(null);
  const spaceHeldRef = useRef(false);
  const bets = session?.allowedBets ?? [];
  const inMode = Boolean(freeSpins && freeSpins.remaining > 0);
  const spinning = spinningReels.some(Boolean);
  presentationRef.current = presentation;
  const mood = presentation === 'mode-finale' || presentation === 'mode-total'
    ? 'finale'
    : presentation === 'mode-trigger'
      ? 'trigger'
      : presentation === 'mode-intro' || presentation === 'mode-collect'
      ? 'mode'
      : busy ? 'spin' : win > 0 ? 'win' : 'idle';
  const resultLineWins = useRef<SpinResult['lineWins']>([]);
  // STEP-53：本局所有中奖线同时显示（不再逐条轮播）；转动中、进入玉兔模式画面后不显示。
  const shownLines = !busy && !presentation.startsWith('mode-') ? resultLineWins.current ?? [] : [];
  const activeWinCells = winningCells(shownLines);
  const shownLineNumbers = new Set(shownLines.map((line) => line.lineNumber));
  const canAdjustBet = !busy && !inMode && autoRef.current === 0;

  useEffect(() => { preloadLocalSymbols(); preloadLocalArt(); }, []);

  useEffect(() => {
    if (!token) { setError('请从平台大厅进入玉兔送财。'); return; }
    api<Session>(`/api/session?token=${encodeURIComponent(token)}`).then((next) => {
      setSession(next); setCredits(next.credits); setFreeSpins(next.freeSpins); setPresentation(next.freeSpins ? 'mode-spin' : 'idle'); setModeBoardShown(false); setBet(next.freeSpins?.bet ?? next.allowedBets?.[0] ?? 0);
      if (next.freeSpins) setMessage(`财富旋转 · 剩余 ${next.freeSpins.remaining} 次`);
    }).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTickerIndex((index) => (index + 1) % 3), 3200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (presentation !== 'bonus-collect') return;
    const timer = window.setTimeout(() => setPresentation(bonusCollectNext.current), 1_400);
    return () => window.clearTimeout(timer);
  }, [presentation]);

  // 触发局的中奖线展示完，再进入「8 次财富旋转」横幅。
  useEffect(() => {
    if (presentation !== 'trigger-wins') return;
    const timer = window.setTimeout(() => setPresentation('mode-intro'), MODE_FLOW_MS.triggerWins);
    return () => window.clearTimeout(timer);
  }, [presentation]);

  // 横幅 → 金光转场 → 玉兔模式盘面。
  useEffect(() => {
    if (presentation !== 'mode-intro' && presentation !== 'mode-flash') return;
    const timer = window.setTimeout(() => setPresentation(presentation === 'mode-intro' ? 'mode-flash' : 'mode-spin'), presentation === 'mode-intro' ? MODE_FLOW_MS.intro : MODE_FLOW_MS.flash);
    return () => window.clearTimeout(timer);
  }, [presentation]);

  useEffect(() => {
    if (presentation === 'mode-collect') {
      const timer = window.setTimeout(() => setPresentation(freeSpins?.remaining ? 'mode-spin' : 'mode-finale'), 1_400);
      return () => window.clearTimeout(timer);
    }
    // 本轮总赢分够大奖时由大奖画面结束后接着走；不够就直接显示「共赢得」。
    if (presentation !== 'mode-finale' || bigWinTier(modeTotalWin, bet)) return;
    const timer = window.setTimeout(() => setPresentation('mode-total'), 300);
    return () => window.clearTimeout(timer);
  }, [presentation, modeTotalWin, bet]);

  useEffect(() => {
    if (presentation !== 'mode-total') return;
    const timer = window.setTimeout(() => {
      resultLineWins.current = [];
      resultBonusWins.current = [];
      setBoard(mainBoardRef.current ?? openingBoard());
      setWin(0);
      setModeBoardShown(false);
      setMessage(`财富旋转结束 · 本轮共赢 ${fmt(modeTotalWin)}（含触发局），可以继续旋转`);
      setPresentation('idle');
    }, MODE_FLOW_MS.total);
    return () => window.clearTimeout(timer);
  }, [presentation, modeTotalWin]);

  /** 标记某列已经停稳：显示静态盘面。 */
  function markReelStopped(column: number) {
    if (!spinningRef.current[column]) return;
    spinningRef.current = spinningRef.current.map((value, index) => (index === column ? false : value));
    setSpinningReels([...spinningRef.current]);
  }

  /** 让一列减速停在服务器结果上；已经在停的列直接返回同一个 Promise。 */
  function landReel(column: number, result: Board, quick = false): Promise<void> {
    if (!spinningRef.current[column]) return Promise.resolve();
    const handle = reelHandles.current[column];
    if (!handle) { markReelStopped(column); return Promise.resolve(); }
    return handle.land(result[column], quick).then(() => markReelStopped(column));
  }

  /** 出错时：所有列立即停下，显示当前盘面。 */
  function snapReels() {
    reelHandles.current.forEach((handle) => handle?.snap());
    BOARD_HEIGHTS.forEach((_, column) => markReelStopped(column));
  }

  /** 按参考视频的节奏依次停下三列（docs/JADE_RABBIT_MOTION.md 第一节）。 */
  async function animateResult(result: SpinResult, startedAt: number) {
    if (result.mode === 'free') setModeBoardShown(true);
    // 触发局：结果到了先进入触发画面，卷轴多转一会儿再依次停下（STEP-54）。
    const extra = result.triggered && !stopRequested.current ? MODE_FLOW_MS.triggerExtraSpin : 0;
    if (result.triggered) setPresentation('mode-trigger');
    const decelStarts = fast ? COLUMN_DECEL_STARTS_FAST : COLUMN_DECEL_STARTS;
    const gap = (fast ? MIN_COLUMN_GAP_FAST : MIN_COLUMN_GAP) * 1000;
    // 前两列已有 4 个牌匾时，最后一列「有可能」补足 5 个就亮期待蓝光（不提前暴露最后一列的结果）。
    const earlyBonusCount = result.grid.slice(0, 2).flat().filter((entry) => entry.symbolId === 'BONUS_PLATE').length;
    const expectBonus = result.mode === 'paid' && earlyBonusCount === 4;
    const lands: Promise<void>[] = [];
    let previous = -Infinity;
    for (let column = 0; column < BOARD_HEIGHTS.length && !stopRequested.current; column += 1) {
      let at = Math.max(startedAt + extra + decelStarts[column] * 1000, previous + gap);
      if (column === 2 && expectBonus) {
        await wait(Math.max(0, at - performance.now()));
        if (stopRequested.current) break;
        setAnticipating(true);
        at += fast ? 400 : 900;
      }
      await wait(Math.max(0, at - performance.now()));
      if (stopRequested.current) break;
      previous = performance.now();
      lands.push(landReel(column, result.grid));
    }
    // 「立即停止」时剩下的列一起快速停下；已经在停的列不受影响。
    await Promise.all([...lands, ...BOARD_HEIGHTS.map((_, column) => landReel(column, result.grid, stopRequested.current))]);
    setAnticipating(false);
  }

  async function spin(kind: SpinKind = 'manual') {
    if (LOCKED_PRESENTATIONS.has(presentationRef.current)) return;
    if (busyRef.current) {
      // 立即停止：结果还没回来时只记下请求，等结果到了直接停在新盘面上，不会先停在上一局的盘面。
      stopRequested.current = true;
      const arrived = pendingResult.current;
      if (arrived) { setBoard(arrived.grid); if (arrived.mode === 'free') setModeBoardShown(true); BOARD_HEIGHTS.forEach((_, column) => { void landReel(column, arrived.grid, true); }); }
      setMessage(arrived ? '已停止' : '立即停止，等待服务器结算…');
      return;
    }
    if (!session || rules || error) return;
    if (kind === 'manual' && autoRef.current > 0) { autoRef.current = 0; setAutoRemaining(null); setMessage('自动旋转已停止'); return; }
    const isFree = Boolean(freeSpins && freeSpins.remaining > 0);
    if (!isFree && credits < bet) { setMessage('余额不足，请回大厅充值'); return; }
    if (kind === 'auto' && autoRef.current > 0) { autoRef.current -= 1; setAutoRemaining(autoRef.current); }
    if (kind === 'manual') setModePaused(false);
    pendingResult.current = null;
    busyRef.current = true; stopRequested.current = false; setBusy(true); setWin(0); setError('');
    resultLineWins.current = [];
    resultBonusWins.current = [];
    setMessage(isFree ? `财富旋转 · 剩余 ${freeSpins!.remaining} 次` : '旋转中…');
    if (!isFree) setCredits((value) => value - bet);
    spinningRef.current = [true, true, true];
    setSpinningReels([true, true, true]);
    reelHandles.current.forEach((handle, column) => handle?.start(COLUMN_START_DELAYS[column]));
    const startedAt = performance.now();
    try {
      // 告诉服务器这一局是财富旋转还是付费局；状态对不上时服务器返回 409，不会把财富旋转的重试当成付费局扣款。
      const result = await api<SpinResult>('/api/spin', { token, bet, mode: isFree ? 'free' : 'paid', ...(isFree && freeSpins?.parentRoundId ? { parentRoundId: freeSpins.parentRoundId } : {}) });
      if (result.gameId !== 'jade-rabbit') throw new Error('服务器返回了不匹配的游戏盘面。');
      pendingResult.current = result;
      // 静态盘面在转动时是隐藏的，先换成结果，停稳后直接显示。
      setBoard(result.grid);
      await animateResult(result, startedAt);
      if (result.mode === 'paid') mainBoardRef.current = result.grid;
      if (result.mode === 'free') setModeBoardShown(true);
      setLastRoundId(result.roundId);
      if (result.credits !== null) setCredits(result.credits);
      setBet(result.bet); setWin(result.payout); setFreeSpins(result.freeSpins); resultLineWins.current = result.lineWins ?? [];
      resultBonusWins.current = result.bonusWins ?? [];
      if (result.freeSpinsFinished) setModeTotalWin(result.freeSpinsFinished.totalWin);
      // 付费局赢分够大奖时，中奖展示之后弹出大奖画面。财富旋转的单局不弹，整轮结束时按总额弹；触发局的赢分算在总额里。
      const paidNext: RabbitPresentation = result.triggered ? 'mode-intro' : result.mode === 'paid' && bigWinTier(result.payout, result.bet) ? 'big-win' : 'idle';
      if (result.triggered) setModeBoardShown(false);
      if (result.bonusWins && result.bonusWins.length >= 5 && result.mode !== 'free') {
        bonusCollectNext.current = paidNext;
        setPresentation('bonus-collect');
      } else if (result.triggered) {
        setPresentation(result.lineWins && result.lineWins.length > 0 ? 'trigger-wins' : 'mode-intro');
      } else if (paidNext === 'big-win') {
        setPresentation('big-win');
      } else if (result.mode === 'free') {
        setPresentation(result.bonusWins && result.bonusWins.length >= 5 ? 'mode-collect' : result.freeSpinsFinished ? 'mode-finale' : 'mode-spin');
      } else {
        setPresentation('idle');
      }
      // 触发玉兔模式时停止自动旋转（模式会自己接着转完 8 次）。单独一句，不能插进下面的提示文案链。
      if (result.triggered && autoRef.current > 0) { autoRef.current = 0; setAutoRemaining(null); }
      if (result.settlementPending) setMessage('平台派彩稍有延迟，赢分会自动到账。');
      else if (result.freeSpinsFinished) setMessage(`财富旋转结束 · 本轮共赢 ${fmt(result.freeSpinsFinished.totalWin)}（含触发局）`);
      else if (result.triggered) setMessage('恭喜触发 8 次财富旋转！');
      else if (result.payout > 0) setMessage(`赢得 ${fmt(result.payout)}`);
      else setMessage(isFree ? '本次财富旋转未凑够 5 个牌匾' : '本局未中奖，再来一次');
      if (result.capped) { setMessage('本轮已达到 5000 倍封顶。'); autoRef.current = 0; setAutoRemaining(null); }
    } catch (e) {
      snapReels(); setAnticipating(false);
      const err = e as Error & { status?: number };
      setMessage(err.status === 402 ? '余额不足，请回大厅充值' : err.message);
      // 出错时停止自动旋转，并按服务器的真实状态同步余额和玉兔模式。
      if (autoRef.current > 0) { autoRef.current = 0; setAutoRemaining(null); }
      if (isFree) setModePaused(true);
      api<Session>(`/api/session?token=${encodeURIComponent(token)}`).then((next) => {
        setCredits(next.credits);
        setFreeSpins(next.freeSpins);
        if (next.freeSpins && !isFree) { setModeBoardShown(false); setPresentation('mode-spin'); setBet(next.freeSpins.bet); }
        if (!next.freeSpins && isFree) {
          setModePaused(false);
          setBoard(mainBoardRef.current ?? openingBoard());
          setModeBoardShown(false);
          setPresentation('idle');
          setMessage('玉兔模式已结束，可以继续旋转。');
        } else if (next.freeSpins && isFree) {
          setMessage(`财富旋转暂时失败（${err.message}），点「财富」按钮继续`);
        }
      }).catch(() => undefined);
    } finally {
      pendingResult.current = null;
      busyRef.current = false; setBusy(false);
    }
  }
  spinRef.current = (kind: SpinKind = 'manual') => { void spin(kind); };

  useEffect(() => {
    if (busy || rules || error || !session || !freeSpins?.remaining || presentation !== 'mode-spin' || modePaused) return;
    const timer = window.setTimeout(() => { void spinRef.current('mode'); }, win > 0 ? 1450 : 720);
    return () => window.clearTimeout(timer);
  }, [busy, rules, error, session, freeSpins, win, board, presentation, modePaused]);

  useEffect(() => {
    // 只在画面空闲时计时；牌匾收集等叠加动画结束回到 idle 后会重新计时，不会卡住。
    if (busy || rules || error || !session || inMode || presentation !== 'idle' || autoRef.current <= 0 || autoRemaining === 0) return;
    if (credits < bet) { autoRef.current = 0; setAutoRemaining(null); setMessage('余额不足，自动旋转已停止'); return; }
    const timer = window.setTimeout(() => { void spinRef.current('auto'); }, win > 0 ? WIN_TIMING.autoNextMs : 420);
    return () => window.clearTimeout(timer);
  }, [busy, rules, error, session, inMode, presentation, autoRemaining, credits, bet, win, board]);

  useEffect(() => {
    const clearSpaceRepeat = () => {
      spaceHeldRef.current = false;
      if (spaceRepeatRef.current !== null) {
        window.clearInterval(spaceRepeatRef.current);
        spaceRepeatRef.current = null;
      }
    };
    // 空格在游戏画面里一律当作「旋转」：即使刚用鼠标点过某个按钮（焦点留在按钮上），也不会去触发那个按钮。
    // 只有输入框、下拉框和规则弹窗里保留浏览器默认行为。
    const keepsDefaultSpace = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, select, textarea, .rabbit-modal'));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || keepsDefaultSpace(event.target)) return;
      event.preventDefault();
      if (spaceHeldRef.current) return;
      if (LOCKED_PRESENTATIONS.has(presentationRef.current)) return;
      spaceHeldRef.current = true;
      spinRef.current();
      spaceRepeatRef.current = window.setInterval(() => {
        if (!busyRef.current && spaceHeldRef.current) spinRef.current();
      }, 760);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      // 按钮是在松开空格时被「点击」的，这里也要阻止，否则焦点所在的按钮（例如「极速」）会被切换。
      if (!keepsDefaultSpace(event.target)) event.preventDefault();
      clearSpaceRepeat();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpaceRepeat);
    return () => {
      clearSpaceRepeat();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpaceRepeat);
    };
  }, []);

  const localArt = useLocalArt();
  const layout: ArtLayout | null = localArt.layout && localArt.bgMain ? localArt.layout : null;
  const modeLook = inMode || presentation.startsWith('mode-');
  const artBackground = modeLook ? localArt.bgMode ?? localArt.bgMain : localArt.bgMain;
  // 中奖线按服务器返回的 lineWins 坐标画，不按线号查本地表，保证和结算一致。
  const artLinePaths = layout ? shownLines.map((line) => line.coordinates.map(({ x, y }) => { const point = cellCenter(layout, x, y, BOARD_HEIGHTS[x]); return `${point.x},${point.y}`; }).join(' ')) : [];
  const linePaths = shownLines.map((line) => line.coordinates.map(({ x, y }) => `${((x + 0.5) / 3) * 300},${((y + 0.5) / BOARD_HEIGHTS[x]) * 100}`).join(' '));
  // 每条中奖线画两层：外面一层橙色光晕，里面一层亮黄色线芯。
  const linePolylines = (paths: string[]) => paths.map((points, index) => <g key={`${shownLines[index]?.lineNumber}-${index}`}><polyline className="rabbit-line-halo" points={points} pathLength={1} /><polyline className="rabbit-line-core" points={points} pathLength={1} /></g>);
  const badges = layout ? lineBadges(layout, shownLines) : [];
  const infoItems = ['5 个奖金牌匾即可赢奖！', '随机触发 8 次财富旋转！', '赢取高达 5000 倍大奖！'];
  const betIndex = bets.indexOf(bet);
  const modeBlankBoard = board.map((column) => column.map(() => EMPTY_TOKEN)) as unknown as Board;
  // 玉兔模式里：还没有本局财富旋转盘面时显示空白盘面；有了就显示真实盘面（包括牌匾不足 5 个的局和最后的结束画面）。
  // 触发画面和「8 次财富旋转」横幅期间仍显示触发局停下的盘面（横幅盖在上面），金光转场时才换成空白的模式盘面。
  const displayBoard = presentation === 'mode-flash' || (presentation.startsWith('mode-') && presentation !== 'mode-trigger' && presentation !== 'mode-intro' && !modeBoardShown)
    ? modeBlankBoard
    : board;
  const activeBonusCells = new Set((resultBonusWins.current ?? []).map((entry) => `${entry.coordinates.x}-${entry.coordinates.y}`));
  // 满 5 个牌匾的收集画面：牌匾发金光，其余格子压暗（主游戏和玉兔模式一样）。
  const collecting = presentation === 'bonus-collect' || presentation === 'mode-collect';

  const reelColumn = (column: readonly Token[], x: number) => <div className={`rabbit-reel-column rows-${BOARD_HEIGHTS[x]} ${spinningReels[x] ? 'is-spinning' : ''} ${x === 2 && anticipating ? 'is-anticipating' : ''}`} key={x}>
    <SpinningReel rows={BOARD_HEIGHTS[x]} bet={bet} strip={(inMode ? MATH_MODE_STRIPS : MATH_STRIPS)[x]} rest={column} spinning={spinningReels[x]} handleRef={reelHandleSetters[x]} />
    {column.map((entry, y) => {
      const key = `${x}-${y}`;
      const bonusLit = collecting && activeBonusCells.has(key);
      const dim = !bonusLit && !activeWinCells.has(key) && (shownLines.length > 0 || collecting);
      return <div className={`rabbit-cell ${activeWinCells.has(key) ? 'is-winning' : ''} ${dim ? 'is-dim' : ''} ${entry.symbolId === 'BONUS_PLATE' ? 'is-bonus' : ''} ${bonusLit ? 'is-bonus-collect' : ''}`} style={{ '--win-col': x } as CSSProperties} key={`${entry.stackGroupId}-${y}`}><RabbitSymbol entry={entry} bet={bet} /></div>;
    })}
  </div>;
  const topBannerText = modeLook ? infoItems[0] : infoItems[tickerIndex];
  const bottomBarText = presentation === 'mode-total' ? `共赢得 ${fmt(modeTotalWin)}` : win > 0 && !busy ? `赢得 ${fmt(win)}` : modeLook ? (inMode ? `玉兔模式！剩余 ${freeSpins!.remaining} 次` : '玉兔模式！') : infoItems[(tickerIndex + 1) % infoItems.length];

  return <main className="rabbit-shell">
    <section className={`rabbit-stage ${modeLook ? 'is-mode' : ''} ${presentation} ${spinning ? 'is-spinning' : ''} ${layout ? 'has-art' : ''}`} style={layout ? { '--art-ratio': layout.imageSize.width / layout.imageSize.height } as CSSProperties : undefined} aria-label="玉兔送财游戏画面">
      {!layout && <div className="rabbit-sky"><span /><span /><span /><span /></div>}
      <header className="rabbit-header">
        <a className="rabbit-home" href="/" aria-label="返回大厅">⌂</a>
        <div className="rabbit-title"><b>玉兔送财</b><small>JADE RABBIT · 虚拟积分演示</small></div>
        <button className="rabbit-info-button" type="button" onClick={() => setRules(true)} aria-label="打开规则与赔付表">?</button>
      </header>
      {layout ? <div className="rabbit-art" style={{ backgroundImage: `url("${artBackground}")` }}>
        <div className="rabbit-art-mascot" style={rectToPercent(layout.mascotArea, layout)}><RabbitMascot mood={mood} /></div>
        <div className="rabbit-art-banner" style={rectToPercent(layout.topBanner, layout)} role="status"><span>{topBannerText}</span></div>
        {displayBoard.map((column, x) => <div className="rabbit-art-reel" style={rectToPercent(layout.reels[x], layout)} key={x}>{reelColumn(column, x)}</div>)}
        <svg className="rabbit-line-layer" viewBox={`0 0 ${layout.imageSize.width} ${layout.imageSize.height}`} preserveAspectRatio="none" aria-hidden="true">{linePolylines(artLinePaths)}</svg>
        {badges.map((badge) => <span className={`rabbit-line-badge is-${badge.side}`} style={{ left: `${(badge.x / layout.imageSize.width) * 100}%`, top: `${(badge.y / layout.imageSize.height) * 100}%` }} key={`${badge.side}-${badge.lineNumber}`}>{badge.lineNumber}</span>)}
        <div className="rabbit-art-bar" style={rectToPercent(layout.bottomBar, layout)} role="status"><span>{bottomBarText}</span></div>
      </div> : <>
      <div className="rabbit-roof" aria-hidden="true">
        <div className="roof-tile roof-tile-left" /><div className="roof-tile roof-tile-center" /><div className="roof-tile roof-tile-right" />
        <div className="roof-crest">福</div><RabbitMascot mood={mood} />
      </div>
      <aside className="rabbit-couplet rabbit-couplet-left" aria-label="左侧对联">恭<br />喜</aside>
      <aside className="rabbit-couplet rabbit-couplet-right" aria-label="右侧对联">发<br />财</aside>
      <div className="rabbit-machine">
        <div className="rabbit-line-rail left">{Array.from({ length: 10 }, (_, index) => <span key={index} className={shownLineNumbers.has(index + 1) ? 'is-active' : ''}>{index + 1}</span>)}</div>
        <div className="rabbit-reels" aria-label="3-4-3 服务器盘面">
          {displayBoard.map((column, x) => reelColumn(column, x))}
          <svg className="rabbit-line-layer" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">{linePolylines(linePaths)}</svg>
        </div>
        <div className="rabbit-line-rail right">{Array.from({ length: 10 }, (_, index) => <span key={index} className={shownLineNumbers.has(index + 1) ? 'is-active' : ''}>{index + 1}</span>)}</div>
      </div>
      </>}
      {presentation === 'mode-trigger' && <TriggerOverlay />}
      {presentation === 'mode-intro' && <IntroBanner spins={freeSpins?.remaining ?? MODE_SPINS} />}
      {presentation === 'mode-flash' && <div className="rabbit-flash" aria-hidden="true" />}
      {presentation === 'big-win' && <BigWinOverlay amount={win} bet={bet} delaySeconds={0.6} onDone={() => setPresentation('idle')} />}
      {presentation === 'mode-finale' && bigWinTier(modeTotalWin, bet) && <BigWinOverlay amount={modeTotalWin} bet={bet} delaySeconds={0.3} onDone={() => setPresentation('mode-total')} />}
      {presentation === 'mode-total' && <CoinRain />}
      {!layout && <div className="rabbit-info-strip" role="status"><span className="info-seal">玉</span><span>{presentation === 'mode-total' ? `共赢得 ${fmt(modeTotalWin)}` : win > 0 && !busy ? `赢得 ${fmt(win)}` : infoItems[tickerIndex]}</span><span className="info-seal">兔</span></div>}
      {inMode && !layout && <div className="rabbit-mode-badge">财富旋转 · 剩余 {freeSpins!.remaining} 次</div>}
      {error && <div className="rabbit-error" role="alert">{error} <a href="/">返回大厅</a></div>}
      <section className="rabbit-bottom" aria-label="游戏控制区">
        <div className="rabbit-stats"><div><span>余额</span><strong>{fmt(credits)}</strong></div><div><span>投注</span><strong className="bet-number">{fmt(bet)}</strong></div><div><span>赢分</span><strong>{fmt(win)}</strong></div></div>
        <div className="rabbit-controls">
          <div className="rabbit-bet-controls"><button type="button" onClick={() => betIndex > 0 && setBet(bets[betIndex - 1])} disabled={!canAdjustBet || betIndex <= 0} aria-label="减少投注">−</button><span>{fmt(bet)}</span><button type="button" onClick={() => betIndex >= 0 && betIndex < bets.length - 1 && setBet(bets[betIndex + 1])} disabled={!canAdjustBet || betIndex < 0 || betIndex >= bets.length - 1} aria-label="增加投注">+</button></div>
          <button className="rabbit-max" type="button" disabled={!canAdjustBet || bets.length === 0} onClick={() => setBet(bets[bets.length - 1])}>最大投注</button>
          <label className="rabbit-auto"><span>自动</span><select value={autoCount} onChange={(event) => setAutoCount(event.target.value)} disabled={busy || inMode}><option value="5">5 次</option><option value="10">10 次</option><option value="25">25 次</option><option value="50">50 次</option></select></label>
          <button className={`rabbit-fast ${fast ? 'is-on' : ''}`} type="button" onClick={() => setFast((value) => !value)} aria-pressed={fast}>极速</button>
          <button className={`rabbit-spin ${inMode ? 'is-mode' : ''}`} type="button" onClick={() => { void spin(); }} disabled={!session || (!inMode && credits < bet && !busy) || Boolean(error) || LOCKED_PRESENTATIONS.has(presentation)}>{busy ? '立即停止' : inMode ? `财富 ${freeSpins!.remaining}` : '旋转'}</button>
          {!busy && !inMode && autoRef.current === 0 && <button className="rabbit-auto-start" type="button" onClick={() => { const count = Number(autoCount); if (credits < bet) { setMessage('余额不足，无法自动旋转'); return; } autoRef.current = count; setAutoRemaining(count); setMessage(`自动旋转 ${count} 次`); }}>自动旋转</button>}
          {autoRef.current > 0 && <button className="rabbit-auto-stop" type="button" onClick={() => { autoRef.current = 0; setAutoRemaining(null); setMessage('自动旋转已停止'); }}>停止自动 · {autoRemaining}</button>}
        </div>
        <p className="rabbit-message">{message}{autoRemaining !== null && autoRef.current > 0 ? ` · 自动剩余 ${autoRemaining}` : ''}</p>
      </section>
      <p className="rabbit-demo-note">演示平台 · 仅虚拟积分 · 不涉及真实货币 · 局号 {busy ? '结算中' : lastRoundId || '—'}</p>
      {rules && <RulesModal bet={bet} bets={bets} onClose={() => setRules(false)} />}
    </section>
  </main>;
}
