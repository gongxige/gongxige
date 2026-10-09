import { ROWS, type SymbolId } from '../engine/index.ts';

// Which symbol sits at each index of a reel's (endless) tape. The tape is the
// real reel strip, so what flies past while spinning is what the strip holds.
//
// When the reel is told to land, a new anchor maps the landing index to the
// server's stop. Indices from that window upward follow the new anchor;
// everything below it (already on screen) keeps the previous mapping, so
// nothing visible changes. The seam is always above the window, off-screen.

type Anchor = { index: number; stop: number };

export class ReelTape {
  private readonly strip: readonly SymbolId[];
  private anchors: Anchor[]; // newest (smallest index) first

  constructor(strip: readonly SymbolId[], stop: number) {
    this.strip = strip;
    this.anchors = [{ index: 0, stop }];
  }

  symbolAt(index: number): SymbolId {
    const anchor = this.anchors.find((a) => index < a.index + ROWS) ?? this.anchors[this.anchors.length - 1];
    const length = this.strip.length;
    return this.strip[(((anchor.stop + index - anchor.index) % length) + length) % length];
  }

  /** From now on, indices `index .. index+ROWS-1` show the strip window at `stop`. */
  land(index: number, stop: number) {
    this.anchors.unshift({ index, stop });
    this.anchors.length = Math.min(this.anchors.length, 3);
  }
}
