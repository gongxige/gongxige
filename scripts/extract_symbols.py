"""Re-cut the reel symbols from frames of the original reference video.

The first symbol set was cropped at fixed cell positions, which left them
dim, cut off (medallions are larger than a cell) and carrying slivers of the
neighbouring cells. This script instead takes one clean, resting instance
of each symbol from a full 1280x720 frame, keys out the cream reel
background, keeps only the symbol itself, brightens it, and writes a
transparent PNG to public/reels/.

Usage (needs Pillow, numpy, scipy):
    python scripts/extract_symbols.py <frames_dir> [--review out.png]

<frames_dir> holds full-size frames of the original video, rotated upright
and named a0001.jpg, a0002.jpg, ... (every frame), e.g.:
    ffmpeg -i <original.mp4> -vf transpose=2 -q:v 2 <frames_dir>/a%04d.jpg
The video and frames are local reference material and are not in git.
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

# Reel window in a 1280x720 frame, and the size of one cell.
BOARD_X, BOARD_Y, CELL_W, CELL_H = 145, 145, 201, 114.25
BOARD_BOTTOM = BOARD_Y + 4 * CELL_H

# symbol -> (frame number, row, column, options) of a clean resting instance.
# Options:
#   ellipse   (half-width, half-height) in px around the cell centre; anything
#             outside is dropped. Medallions overlap the medallions above and
#             below them, and this trims those neighbours off.
#   margin_x  horizontal margin beyond the cell (default MARGIN_X).
#   thin      remove lines up to this many px wide (stray separator lines).
#   rect      (left, top, right, bottom) in px relative to the cell's top-left:
#             cut this rectangle as-is, no keying (the wild is a framed card);
#             brightness comes from the cream of `cream_cell` (row, col).
SOURCES = {
    "Q": (30, 0, 0, {}),
    "K": (250, 1, 1, {}),
    "10": (30, 1, 2, {}),
    "J": (30, 1, 3, {}),
    "A": (940, 0, 0, {}),
    "9": (199, 0, 2, {}),
    "elephant": (30, 1, 0, {"ellipse": (96, 60)}),
    "deer": (427, 0, 2, {"ellipse": (96, 62)}),
    "lion": (840, 1, 1, {"ellipse": (96, 60)}),
    "bull": (30, 1, 1, {"thin": 2}),
    "zebra": (135, 2, 1, {"ellipse": (96, 60)}),
    "coin": (135, 2, 4, {"ellipse": (99, 84), "margin_x": 2}),
    "wild": (640, 0, 2, {"rect": (-2, -1, 181, 109), "cream_cell": (0, 0)}),
}

# Medallions spill above and below their cell, so look this far beyond it
# vertically. Horizontally stay just inside the cell: the reel separators sit
# on the cell edges and would otherwise glue neighbours onto the symbol.
MARGIN_X, MARGIN_Y = -7, 30
# Colour distance from the cream background that still counts as background.
BG_DISTANCE = 52
# Output canvas: one cell wide, 1.5 cells tall (see main()).
CANVAS = (202, 171)
# What the cream background should look like after brightening.
CREAM_TARGET = np.array([246, 238, 196], dtype=float)


def cream_of(frame: Image.Image, row: int, col: int) -> np.ndarray:
    """Cream background colour of a cell: median of its brightest border pixels."""
    x0, y0 = BOARD_X + col * CELL_W, BOARD_Y + row * CELL_H
    rgb = np.asarray(frame.convert("RGB").crop((int(x0 + 8), int(y0 + 4), int(x0 + CELL_W - 8), int(y0 + CELL_H - 4)))).astype(float)
    border = np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3), rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    lum = border.mean(axis=1)
    return np.median(border[lum >= np.percentile(lum, 70)], axis=0)


def cut_rect(frame: Image.Image, row: int, col: int, rect: tuple[int, int, int, int], cream_cell: tuple[int, int]) -> Image.Image:
    x0, y0 = BOARD_X + col * CELL_W, BOARD_Y + row * CELL_H
    rgb = np.asarray(frame.convert("RGB").crop((int(x0 + rect[0]), int(y0 + rect[1]), int(x0 + rect[2]), int(y0 + rect[3])))).astype(float)
    # The card covers its whole cell, so take the brightness reference from a
    # letter cell in the same frame.
    bright = np.clip(rgb * (CREAM_TARGET / cream_of(frame, *cream_cell)), 0, 255).astype(np.uint8)
    return Image.fromarray(bright).convert("RGBA")


def cut_symbol(frame: Image.Image, row: int, col: int, ellipse: tuple[int, int] | None = None, margin_x: int = MARGIN_X, thin: int = 0, rect: tuple[int, int, int, int] | None = None, cream_cell: tuple[int, int] = (0, 0)) -> Image.Image:
    if rect:
        return cut_rect(frame, row, col, rect, cream_cell)
    x0 = BOARD_X + col * CELL_W - margin_x
    y0 = BOARD_Y + row * CELL_H - MARGIN_Y
    box = (int(x0), int(max(y0, BOARD_Y)), int(x0 + CELL_W + 2 * margin_x), int(min(y0 + CELL_H + 2 * MARGIN_Y, BOARD_BOTTOM)))
    rgb = np.asarray(frame.crop(box).convert("RGB")).astype(float)
    h, w, _ = rgb.shape

    # Cream reference: the brightest, least saturated pixels around the border.
    border = np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3), rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    lum = border.mean(axis=1)
    cream = np.median(border[lum >= np.percentile(lum, 70)], axis=0)

    distance = np.linalg.norm(rgb - cream, axis=2)
    bg_like = distance < BG_DISTANCE

    # Background = cream pixels connected to the window border.
    labels, _ = ndimage.label(bg_like)
    edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, edge_labels[edge_labels > 0])

    # Foreground pieces: the symbol is the piece covering most of the cell's
    # central area. Detached ornaments (crowns, fleur-de-lis) are kept when
    # they sit right next to it and do not touch the window edge.
    fg = ndimage.binary_opening(~background, iterations=1 + thin)
    pieces, count = ndimage.label(fg, structure=np.ones((3, 3)))
    centre = np.zeros_like(fg)
    centre[int(h * 0.3):int(h * 0.7), int(w * 0.25):int(w * 0.75)] = True
    overlap = ndimage.sum(centre, pieces, range(1, count + 1))
    main = int(np.argmax(overlap)) + 1
    keep = pieces == main
    near = ndimage.binary_dilation(keep, iterations=18)
    for i, sl in enumerate(ndimage.find_objects(pieces), start=1):
        if i == main or sl is None:
            continue
        piece = pieces == i
        touches_edge = sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == h or sl[1].stop == w
        if not touches_edge and piece.sum() > 60 and (piece & near).any():
            keep |= piece
    if thin:
        # Opening shaved the symbol's outline too; grow back within the original foreground.
        keep = ndimage.binary_dilation(keep, iterations=thin) & ~background
    keep = ndimage.binary_fill_holes(keep)
    if ellipse:
        # Cell centre in window coordinates (the window may be clipped at the board edge).
        ccx = BOARD_X + (col + 0.5) * CELL_W - box[0]
        ccy = BOARD_Y + (row + 0.5) * CELL_H - box[1]
        yy, xx = np.mgrid[0:h, 0:w]
        keep &= ((xx - ccx) / ellipse[0]) ** 2 + ((yy - ccy) / ellipse[1]) ** 2 <= 1

    # Soft edge: fade pixels that are still close to cream at the rim.
    rim = keep & ~ndimage.binary_erosion(keep, iterations=2)
    alpha = keep.astype(float)
    alpha[rim] = np.clip((distance[rim] - BG_DISTANCE * 0.5) / (BG_DISTANCE * 0.8), 0, 1)
    alpha = ndimage.gaussian_filter(alpha, 0.6) * keep

    # The video is dim: scale each channel so the cream would hit CREAM_TARGET.
    bright = np.clip(rgb * (CREAM_TARGET / cream), 0, 255)

    rgba = np.dstack([bright, alpha * 255]).astype(np.uint8)
    ys, xs = np.nonzero(alpha > 0.05)
    pad = 2
    return Image.fromarray(rgba).crop((max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad + 1, w), min(ys.max() + pad + 1, h)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("frames_dir")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "reels"))
    parser.add_argument("--review", help="also write a contact sheet of the results here")
    args = parser.parse_args()

    results = {}
    for symbol, (frame_no, row, col, options) in SOURCES.items():
        frame = Image.open(os.path.join(args.frames_dir, f"a{frame_no:04d}.jpg"))
        results[symbol] = cut_symbol(frame, row, col, **options)
        # Every symbol goes centred onto the same canvas: one cell wide and
        # 1.5 cells tall, so the game can draw them all at one scale and the
        # big ones (coin, bull) spill over their cell like in the original.
        canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        image = results[symbol]
        canvas.paste(image, ((CANVAS[0] - image.width) // 2, (CANVAS[1] - image.height) // 2), image)
        canvas.save(os.path.join(args.out, f"{symbol}.png"), optimize=True)
        print(f"{symbol:9s} frame {frame_no:4d} r{row}c{col} -> {image.size}")

    if args.review:
        cell = (260, 160)
        columns = 5
        rows = -(-len(results) // columns)
        sheet = Image.new("RGB", (cell[0] * columns, cell[1] * rows), (241, 230, 176))
        for n, image in enumerate(results.values()):
            x, y = (n % columns) * cell[0], (n // columns) * cell[1]
            sheet.paste(image, (x + (cell[0] - image.width) // 2, y + (cell[1] - image.height) // 2), image)
        sheet.save(args.review)


if __name__ == "__main__":
    main()
