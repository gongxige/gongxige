type Props = {
  bet: number;
  bets: readonly number[];
  onBetChange: (bet: number) => void;
  /** Big number in the centre panel, or null to show `message` instead. */
  winDisplay: number | null;
  message: string;
  spinning: boolean;
  winning: boolean;
  spinDisabled: boolean;
  onSpin: () => void;
};

export function ControlBar({ bet, bets, onBetChange, winDisplay, message, spinning, winning, spinDisabled, onSpin }: Props) {
  const index = bets.indexOf(bet);
  return (
    <footer className="control-bar">
      <div className="bet-group">
        <span className="bet-label">投注</span>
        <button type="button" className="step-button" aria-label="减少投注" disabled={spinning || index <= 0} onClick={() => onBetChange(bets[index - 1])}>−</button>
        <output className="bet-value" aria-label="当前投注">{bet}</output>
        <button type="button" className="step-button" aria-label="增加投注" disabled={spinning || index >= bets.length - 1} onClick={() => onBetChange(bets[index + 1])}>+</button>
      </div>
      <div className={`win-panel ${winDisplay !== null ? 'is-winning' : ''}`} aria-live="polite">
        {winDisplay !== null ? <><span>赢分</span><strong>{winDisplay.toLocaleString('zh-CN')}</strong></> : <span className="win-message">{message}</span>}
      </div>
      <button type="button" className={`spin-button ${winning ? 'is-win' : ''} ${spinning ? 'is-spinning' : ''}`} onClick={onSpin} disabled={spinDisabled}>
        {spinning ? '停止' : '旋转'}
      </button>
    </footer>
  );
}
