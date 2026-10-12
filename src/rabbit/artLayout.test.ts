import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellCenter, parseArtLayout, rectToPercent } from './artLayout.ts';

const sample = {
  note: 'Coordinates in pixels of bg-main.png / bg-mode.png (931 x 1230).',
  imageSize: { width: 931, height: 1230 },
  reels: [
    { x: 135, y: 470, width: 210, height: 578, rows: 3 },
    { x: 354, y: 380, width: 234, height: 760, rows: 4 },
    { x: 597, y: 470, width: 210, height: 578, rows: 3 },
  ],
  topBanner: { x: 292, y: 292, width: 356, height: 70 },
  bottomBar: { x: 175, y: 1150, width: 582, height: 68 },
  mascotArea: { x: 330, y: 0, width: 270, height: 230 },
};

describe('玉兔送财本机背景布局', () => {
  it('读取 layout.json 的卷轴、提示条、信息条和吉祥物区域', () => {
    const layout = parseArtLayout(sample);
    assert.ok(layout);
    assert.deepEqual(layout.imageSize, { width: 931, height: 1230 });
    assert.equal(layout.reels[1].height, 760);
    assert.deepEqual(layout.bottomBar, sample.bottomBar);
  });

  it('结构不完整或不是 JSON 对象时返回 null（界面退回原布局）', () => {
    assert.equal(parseArtLayout(null), null);
    assert.equal(parseArtLayout('<!doctype html>'), null);
    assert.equal(parseArtLayout({ ...sample, reels: sample.reels.slice(0, 2) }), null);
    assert.equal(parseArtLayout({ ...sample, topBanner: { x: 1, y: 2, width: 0, height: 5 } }), null);
    assert.equal(parseArtLayout({ ...sample, imageSize: { width: '931', height: 1230 } }), null);
  });

  it('按背景像素换算百分比位置和中奖线格子中心', () => {
    const layout = parseArtLayout(sample)!;
    const left = rectToPercent(layout.reels[0], layout);
    assert.equal(left.left, `${(135 / 931) * 100}%`);
    assert.equal(left.height, `${(578 / 1230) * 100}%`);
    assert.deepEqual(cellCenter(layout, 1, 0, 4), { x: 354 + 117, y: 380 + 95 });
    assert.deepEqual(cellCenter(layout, 2, 2, 3), { x: 597 + 105, y: 470 + (2.5 / 3) * 578 });
  });
});
