type Props = { credits: number; bet: number; win: number; onRules: () => void; disabled: boolean };

const format = (value: number) => value.toLocaleString('zh-CN');

export function TopBar({ credits, bet, win, onRules, disabled }: Props) {
  return (
    <header className="top-bar">
      <a className="icon-button top-left home-button" href="/" aria-label="返回大厅" title="返回大厅">⌂</a>
      <div className="top-panel">
        <div className="stat"><span>余额</span><strong className="coin-value">{format(credits)}</strong></div>
        <div className="stat"><span>投注</span><strong className="red-value">{format(bet)}</strong></div>
        <div className="stat"><span>赢分</span><strong className="gold-value">{format(win)}</strong></div>
      </div>
      <button type="button" className="icon-button top-right" onClick={onRules} aria-label="规则与赔率" disabled={disabled}>ⓘ</button>
      <small className="game-demo-notice">演示平台 · 仅虚拟积分 · 不涉及真实货币</small>
    </header>
  );
}
