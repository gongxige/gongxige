// 阶段 12 / STEP-46：public/local-assets/jade-rabbit/layout.json 的格式和校验（纯逻辑，可单独测试）。
// 坐标是背景图（931×1230）上的像素，界面按背景缩放后的百分比摆放卷轴、提示条和吉祥物。

export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ArtLayout = Readonly<{
  imageSize: Readonly<{ width: number; height: number }>;
  reels: readonly [Rect, Rect, Rect];
  topBanner: Rect;
  bottomBar: Rect;
  mascotArea: Rect;
}>;

const isRect = (value: unknown): value is Rect => {
  if (!value || typeof value !== 'object') return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) && (width as number) > 0 && (height as number) > 0;
};

/** 只接受结构完整的 layout.json；不完整时返回 null，界面退回原来自己画的布局。 */
export function parseArtLayout(value: unknown): ArtLayout | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const size = data.imageSize as Record<string, unknown> | undefined;
  if (!size || typeof size.width !== 'number' || typeof size.height !== 'number' || !(size.width > 0) || !(size.height > 0)) return null;
  const reels = data.reels;
  if (!Array.isArray(reels) || reels.length !== 3 || !reels.every(isRect)) return null;
  if (!isRect(data.topBanner) || !isRect(data.bottomBar) || !isRect(data.mascotArea)) return null;
  return {
    imageSize: { width: size.width, height: size.height },
    reels: [reels[0], reels[1], reels[2]],
    topBanner: data.topBanner,
    bottomBar: data.bottomBar,
    mascotArea: data.mascotArea,
  };
}

/** 把背景图上的像素矩形换算成相对背景的百分比位置（随背景一起缩放）。 */
export function rectToPercent(rect: Rect, layout: ArtLayout) {
  const { width, height } = layout.imageSize;
  return {
    left: `${(rect.x / width) * 100}%`,
    top: `${(rect.y / height) * 100}%`,
    width: `${(rect.width / width) * 100}%`,
    height: `${(rect.height / height) * 100}%`,
  };
}

/** 中奖线经过的格子中心点（背景图像素坐标），rows 为该列行数。 */
export function cellCenter(layout: ArtLayout, x: 0 | 1 | 2, y: number, rows: number) {
  const reel = layout.reels[x];
  return { x: reel.x + reel.width / 2, y: reel.y + ((y + 0.5) / rows) * reel.height };
}
