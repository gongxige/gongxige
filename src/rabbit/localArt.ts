import { useSyncExternalStore } from 'react';
import { parseArtLayout, type ArtLayout } from './artLayout.ts';
import { LOCAL_ASSET_DIR } from './localSymbolImages.ts';

// 阶段 12 / STEP-46：玉兔送财的本机背景、中国结格子和奖金牌匾（public/local-assets/jade-rabbit/，不进 Git）。
// 每张图单独预加载，缺哪张就退回哪部分原来自己画的画面；背景图还需要 layout.json 才能对齐卷轴。

const ART_FILES = {
  bgMain: 'bg-main.png',
  bgMode: 'bg-mode.png',
  knotTile: 'knot-tile.png',
  bonusPlate: 'bonus-plate.png',
} as const;
type ArtKey = keyof typeof ART_FILES;

export type LocalArt = Readonly<{
  layout: ArtLayout | null;
  bgMain: string | null;
  bgMode: string | null;
  knotTile: string | null;
  bonusPlate: string | null;
}>;

let art: LocalArt = { layout: null, bgMain: null, bgMode: null, knotTile: null, bonusPlate: null };
const listeners = new Set<() => void>();
let started = false;

function update(patch: Partial<LocalArt>) {
  art = { ...art, ...patch };
  listeners.forEach((listener) => listener());
}

/** 页面打开时预加载 4 张图和 layout.json；图片解码完成后才启用，避免显示时闪白。 */
export function preloadLocalArt() {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const [key, file] of Object.entries(ART_FILES) as [ArtKey, string][]) {
    const src = `${LOCAL_ASSET_DIR}${file}`;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const ready = () => { if (image.naturalWidth > 0) update({ [key]: src }); };
      image.decode ? image.decode().then(ready, ready) : ready();
    };
    image.src = src;
  }
  fetch(`${LOCAL_ASSET_DIR}layout.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => update({ layout: parseArtLayout(data) }))
    .catch(() => undefined);
}

/** 运行中图片出错（例如文件被删）时停用这张图，退回原来的画法。 */
export function markLocalArtFailed(key: ArtKey) {
  if (art[key] !== null) update({ [key]: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLocalArt(): LocalArt {
  return useSyncExternalStore(subscribe, () => art, () => art);
}
