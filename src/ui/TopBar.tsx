type Props = { credits: number; bet: number; win: number; onRules: () => void; onSettings: () => void; disabled: boolean };

const format = (value: number) => value.toLocaleString('zh-CN');

export function TopBar({ credits, bet, win, onRules, onSettings, disabled }: Props) {
  return (
    <header className="top-bar">
      <button type="button" className="icon-button top-left" onClick={onRules} aria-label="规则与赔率" disabled={disabled}>ⓘ</button>
      <div className="top-panel">
        <div className="stat"><span>余额</span><strong className="coin-value">{format(credits)}</strong></div>
        <div className="stat"><span>投注</span><strong className="red-value">{format(bet)}</strong></div>
        <div className="stat"><span>赢分</span><strong className="gold-value">{format(win)}</strong></div>
      </div>
      <button type="button" className="icon-button top-right" onClick={onSettings} aria-label="测试管理" disabled={disabled}>⚙</button>
    </header>
  );
}
