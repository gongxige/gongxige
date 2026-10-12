import { useSyncExternalStore } from 'react';
import type { SymbolId } from './engine/index.ts';

// 阶段 12：玉兔送财的普通符号优先使用本机素材 public/local-assets/jade-rabbit/（不进 Git）。
// 图片还没加载好或加载失败时，界面继续显示原创 SVG，所以没有这些文件也能正常玩。

export const LOCAL_ASSET_DIR = `${import.meta.env.BASE_URL}local-assets/jade-rabbit/`;

export const LOCAL_SYMBOL_FILES: Partial<Record<SymbolId, string>> = {
  WILD: 'wild.png',
  YUANBAO: 'yuanbao.png',
  FU_BAG: 'fu-bag.png',
  RED_ENVELOPE: 'red-envelope.png',
  COPPER_COIN: 'copper-coin.png',
  FIRECRACKER: 'firecracker.png',
  CARROT: 'carrot.png',
};

type LoadState = 'loading' | 'ready' | 'failed';

const states = new Map<SymbolId, LoadState>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<SymbolId, LoadState> = new Map();
let started = false;

function setState(id: SymbolId, state: LoadState) {
  if (states.get(id) === state) return;
  states.set(id, state);
  snapshot = new Map(states);
  listeners.forEach((listener) => listener());
}

/** 页面打开时预加载全部 7 张符号图，转动时不会再临时下载而闪白。 */
export function preloadLocalSymbols() {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const [id, file] of Object.entries(LOCAL_SYMBOL_FILES) as [SymbolId, string][]) {
    setState(id, 'loading');
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      // 先解码再切换，避免第一次显示时空白一帧。
      const ready = () => setState(id, image.naturalWidth > 0 ? 'ready' : 'failed');
      image.decode ? image.decode().then(ready, ready) : ready();
    };
    image.onerror = () => setState(id, 'failed');
    image.src = `${LOCAL_ASSET_DIR}${file}`;
  }
}

/** 渲染时图片出错（例如运行中文件被删）也退回 SVG。 */
export function markLocalSymbolFailed(id: SymbolId) {
  setState(id, 'failed');
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 返回已加载好的本机图片地址；没有图或还没加载好时返回 null（显示 SVG）。 */
export function useLocalSymbolSrc(id: SymbolId): string | null {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const file = LOCAL_SYMBOL_FILES[id];
  return file && current.get(id) === 'ready' ? `${LOCAL_ASSET_DIR}${file}` : null;
}
