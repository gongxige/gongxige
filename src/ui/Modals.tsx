import type { FormEvent, ReactNode } from 'react';
import { BET_MULTIPLIER, FREE_SPINS_AWARD, FREE_SPINS_TRIGGER, SCATTER, SCATTER_PAYTABLE, WAYS_PAYTABLE, WAYS_SYMBOLS, WILD } from '../engine/index.ts';
import { symbolSrc } from '../useReels.ts';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button></header>
        {children}
      </section>
    </div>
  );
}

export function RulesModal({ bet, onClose }: { bet: number; onClose: () => void }) {
  const unit = bet / BET_MULTIPLIER;
  return (
    <Modal title="规则与赔率" onClose={onClose}>
      <p>1024 Ways：同一符号从<strong>最左列开始</strong>，连续出现在 3 列或以上即中奖，不限行。每列出现几个就乘几，例如第 1 列 2 个、第 2 列 1 个、第 3 列 2 个 = 4 路。</p>
      <p>下表为当前投注 <strong>{bet}</strong> 时<strong>每一路</strong>的赢分。</p>
      <table className="paytable">
        <thead><tr><th>符号</th><th>3 连</th><th>4 连</th><th>5 连</th></tr></thead>
        <tbody>
          {WAYS_SYMBOLS.map((symbol) => (
            <tr key={symbol}>
              <td><img src={symbolSrc(symbol)} alt={symbol} /></td>
              {([3, 4, 5] as const).map((n) => <td key={n}>{WAYS_PAYTABLE[symbol][n] * unit}</td>)}
            </tr>
          ))}
          <tr className="scatter-row">
            <td><img src={symbolSrc(SCATTER)} alt="金币" /></td>
            {([3, 4, 5] as const).map((n) => <td key={n}>{SCATTER_PAYTABLE[n] * bet}</td>)}
          </tr>
        </tbody>
      </table>
      <div className="rule-row"><img src={symbolSrc(WILD)} alt="百搭" /><p><strong>百搭</strong>：只出现在第 2、3、4 列，可代替除金币外的所有符号，本身不单独赢分。</p></div>
      <div className="rule-row"><img src={symbolSrc(SCATTER)} alt="金币" /><p><strong>金币</strong>：任意位置出现 {FREE_SPINS_TRIGGER} 个及以上，按总投注倍数赢分（见表最后一行），并获得 <strong>{FREE_SPINS_AWARD} 次免费游戏</strong>。免费游戏不扣分、沿用触发时的投注、自动进行；免费游戏中再出 {FREE_SPINS_TRIGGER} 个金币，再加 {FREE_SPINS_AWARD} 次。</p></div>
      <p className="modal-note">多个中奖同时成立时全部相加。</p>
    </Modal>
  );
}

type SettingsProps = { rtp: number; maxWinMultiplier: number; onSave: (maxWin: number) => void; onClose: () => void };

export function SettingsModal({ rtp, maxWinMultiplier, onSave, onClose }: SettingsProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(Number(new FormData(event.currentTarget).get('maxWin')));
  };
  return (
    <Modal title="本机测试管理" onClose={onClose}>
      <form className="settings-form" onSubmit={submit}>
        <p>所有数值仅用于本机虚拟积分演示；没有充值、提现或真实货币。</p>
        <p>理论 RTP：<strong>{rtp}%</strong>（由卷轴条带和赔率表计算得出，修改方法见 src/engine）</p>
        <label>单次最大赢分（投注的倍数，50–5000）<input name="maxWin" type="number" min="50" max="5000" step="1" defaultValue={maxWinMultiplier} /></label>
        <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary">保存到本机</button></div>
      </form>
    </Modal>
  );
}
