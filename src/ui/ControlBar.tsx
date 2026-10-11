import { useState } from 'react';

type Props = {
  bet: number; bets: readonly number[]; onBetChange: (bet: number) => void; betLocked: boolean;
  winDisplay: number | null; message: string; spinning: boolean; freeSpins: boolean; winning: boolean; spinDisabled: boolean;
  autoRemaining: number | null; onRules: () => void; onMax: () => void; onAuto: (count?: number) => void;
  onSpinHoldStart: () => void; onSpinHoldEnd: () => void; onSpin: () => void;
};

export function ControlBar(props: Props) {
  const { bet, bets, onBetChange, betLocked, winDisplay, message, spinning, freeSpins, winning, spinDisabled, autoRemaining, onRules, onMax, onAuto, onSpinHoldStart, onSpinHoldEnd, onSpin } = props;
  const [autoOpen, setAutoOpen] = useState(false);
  const index = bets.indexOf(bet);
  return <footer className="control-bar">
    <button type="button" className="utility-button info-button" aria-label="游戏规则" onClick={onRules}>i</button>
    <div className="bet-group">
      <button type="button" className="step-button" aria-label="减少投注" disabled={betLocked || index <= 0} onClick={() => onBetChange(bets[index - 1])}>−</button>
      <output className="bet-value" aria-label="当前投注">{bet}</output>
      <button type="button" className="step-button" aria-label="增加投注" disabled={betLocked || index >= bets.length - 1} onClick={() => onBetChange(bets[index + 1])}>+</button>
    </div>
    <div className={`win-panel ${winDisplay !== null ? 'is-winning' : ''}`} aria-live="polite">
      {winDisplay !== null ? <><span>赢分</span><strong>{winDisplay.toLocaleString('zh-CN')}</strong></> : <span className="win-message">{message}</span>}
    </div>
    <button type="button" className="utility-button max-button" disabled={betLocked} onClick={onMax}>MAX</button>
    <div className="auto-wrap">
      <button type="button" className={`utility-button auto-button ${autoRemaining !== null ? 'is-active' : ''}`} onClick={() => autoRemaining !== null ? onAuto() : setAutoOpen((open) => !open)}>{autoRemaining === null ? '自动' : `剩余 ${autoRemaining}`}</button>
      {autoOpen && <div className="auto-menu" role="menu">{[10, 25, 50, 100].map((count) => <button key={count} type="button" onClick={() => { setAutoOpen(false); onAuto(count); }}>{count} 次</button>)}</div>}
    </div>
    <button type="button" className={`spin-button ${winning ? 'is-win' : ''} ${spinning || autoRemaining !== null ? 'is-spinning' : ''} ${freeSpins ? 'is-free' : ''}`} onPointerDown={onSpinHoldStart} onPointerUp={onSpinHoldEnd} onPointerCancel={onSpinHoldEnd} onPointerLeave={onSpinHoldEnd} onClick={onSpin} disabled={spinDisabled}>
      <span>{spinning || autoRemaining !== null ? 'STOP' : freeSpins ? '免费' : 'SPIN'}</span><small>{spinning || autoRemaining !== null ? '停止自动旋转' : '长按自动旋转'}</small>
    </button>
  </footer>;
}
