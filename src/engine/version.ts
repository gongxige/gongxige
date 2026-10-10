import { REEL_STRIPS } from './reels.ts';
import { BET_MULTIPLIER, FREE_SPIN_WILD_MULTIPLIERS, FREE_SPINS_FROM_BASE, FREE_SPINS_RETRIGGER, SCATTER_PAYTABLE, WAYS_PAYTABLE, WILD_REELS } from './symbols.ts';

/**
 * Fingerprint of everything that decides a result. The server reports it so
 * the page can tell when the API process is still running older rules (it
 * loads the engine once at start-up and must be restarted after changes);
 * mismatched reels would land on symbols the server never evaluated.
 */
export const ENGINE_VERSION = fnv1a(JSON.stringify({ REEL_STRIPS, WAYS_PAYTABLE, SCATTER_PAYTABLE, WILD_REELS, FREE_SPIN_WILD_MULTIPLIERS, BET_MULTIPLIER, FREE_SPINS_FROM_BASE, FREE_SPINS_RETRIGGER }));

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
