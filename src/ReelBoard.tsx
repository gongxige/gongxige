import { REELS, ROWS } from './engine/index.ts';
import { SLOTS_PER_REEL, symbolSrc, type useReels } from './useReels.ts';

type Props = { reels: ReturnType<typeof useReels>; winningCells: string[] };

/** The 5×4 window: reel columns (moved by useReels) plus a win-highlight layer on top. */
export function ReelBoard({ reels, winningCells }: Props) {
  return (
    <div className="reel-board" aria-label="五列四行滚轮">
      {Array.from({ length: REELS }, (_, reel) => (
        <div className="reel-column" key={reel} ref={reels.registerColumn(reel)}>
          {Array.from({ length: SLOTS_PER_REEL }, (_, k) => {
            const symbol = reels.initialSymbols[reel][k];
            return (
              <div className="reel-slot" key={k} ref={reels.registerSlot(reel, k)}>
                <img src={symbolSrc(symbol)} alt={symbol} draggable={false} />
              </div>
            );
          })}
        </div>
      ))}
      <div className="win-grid" aria-hidden="true">
        {Array.from({ length: ROWS * REELS }, (_, i) => {
          const row = Math.floor(i / REELS);
          const reel = i % REELS;
          return <div key={i} className={`win-cell ${winningCells.includes(`${row}-${reel}`) ? 'is-winning' : ''}`} />;
        })}
      </div>
    </div>
  );
}
