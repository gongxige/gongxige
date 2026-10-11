import type { SymbolId, Token } from './engine/index.ts';

// Mahjong Cascade tile faces, drawn in SVG (original artwork, no external images).
// One 64 × 86 viewBox: an 8-unit back edge under a 64 × 80 face.

export const SYMBOL_NAMES: Record<SymbolId, string> = {
  FA: '發', ZHONG: '中', BAI: '白', WAN8: '八萬', DOT1: '一筒', DOT2: '二筒', DOT3: '三筒', BAM1: '一条', BAM2: '二条', WILD: '百搭', HU: '胡',
};

const GREEN = '#2e8b3d';
const RED = '#c8202a';
const BLUE = '#2a4fa8';

function Face({ symbolId }: { symbolId: SymbolId }) {
  switch (symbolId) {
    case 'FA': return <text x="32" y="55" textAnchor="middle" fontSize="40" fontWeight="700" fill={GREEN}>發</text>;
    case 'ZHONG': return <text x="32" y="55" textAnchor="middle" fontSize="40" fontWeight="700" fill={RED}>中</text>;
    case 'BAI': return <rect x="14" y="16" width="36" height="48" rx="3" fill="none" stroke={BLUE} strokeWidth="4" />;
    case 'WAN8': return <><text x="32" y="38" textAnchor="middle" fontSize="26" fontWeight="700" fill="#1f3c8a">八</text><text x="32" y="68" textAnchor="middle" fontSize="26" fontWeight="700" fill={RED}>萬</text></>;
    case 'DOT1': return <><circle cx="32" cy="40" r="20" fill="none" stroke={BLUE} strokeWidth="4" /><circle cx="32" cy="40" r="12" fill="none" stroke={GREEN} strokeWidth="2.5" /><circle cx="32" cy="40" r="6" fill={RED} /></>;
    case 'DOT2': return <>{[22, 58].map((cy, i) => <g key={cy}><circle cx="32" cy={cy} r="11" fill="none" stroke={i ? BLUE : GREEN} strokeWidth="4" /><circle cx="32" cy={cy} r="4" fill={RED} /></g>)}</>;
    case 'DOT3': return <>{[[16, 18, BLUE], [32, 40, RED], [48, 62, GREEN]].map(([cx, cy, c]) => <g key={cx}><circle cx={cx} cy={cy} r="8.5" fill="none" stroke={c as string} strokeWidth="3.5" /><circle cx={cx} cy={cy} r="3" fill={c as string} /></g>)}</>;
    case 'BAM1': return <><ellipse cx="32" cy="46" rx="11" ry="20" fill={GREEN} /><circle cx="32" cy="26" r="7" fill={RED} /><path d="M32 58v12M26 66l6 4 6-4" stroke="#1d5a28" strokeWidth="3" fill="none" /></>;
    case 'BAM2': return <>{[[10, GREEN], [44, BLUE]].map(([y, c]) => <g key={y}><rect x="26" y={y as number} width="12" height="26" rx="6" fill={c as string} /><rect x="26" y={(y as number) + 11} width="12" height="3" fill="#ffffffaa" /></g>)}</>;
    case 'WILD': return <><text x="32" y="40" textAnchor="middle" fontSize="20" fontWeight="800" fill="#fff4b0">百搭</text><text x="32" y="62" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">WILD</text></>;
    case 'HU': return <text x="32" y="57" textAnchor="middle" fontSize="42" fontWeight="800" fill="#ffd36a">胡</text>;
  }
}

/** A mahjong tile; `golden` paints the gold version (reels 2–4 only). */
export function MahjongTile({ token }: { token: Token }) {
  const { symbolId, golden } = token;
  const special = symbolId === 'WILD' ? 'wild' : symbolId === 'HU' ? 'hu' : golden ? 'gold' : 'plain';
  const colors = {
    plain: { back: '#2f7d5a', face: '#fbf6e6', edge: '#d8c9a0' },
    gold: { back: '#9a6a12', face: '#ffe08a', edge: '#c9961f' },
    wild: { back: '#4a1872', face: '#8e3fd1', edge: '#e7c3ff' },
    hu: { back: '#7a1016', face: '#d8262e', edge: '#ffd36a' },
  }[special];
  return (
    <svg className={`mj-tile is-${special}`} viewBox="0 0 64 86" aria-label={`${golden ? '金色' : ''}${SYMBOL_NAMES[symbolId]}`} role="img">
      <rect x="0" y="6" width="64" height="80" rx="9" fill={colors.back} />
      <rect x="0" y="0" width="64" height="80" rx="9" fill={colors.face} stroke={colors.edge} strokeWidth="2" />
      <rect x="4" y="3" width="56" height="14" rx="6" fill="#ffffff" opacity=".28" />
      <Face symbolId={symbolId} />
    </svg>
  );
}
