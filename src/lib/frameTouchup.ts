// Pure, DOM-free pixel operations for the frame touch-up editor.
//
// Kept independent of the canvas UI so the fill / recolor / stroke math is unit-testable
// (see frameTouchup.test.ts) and so the editor can hand ImageData straight to these
// functions: PixelBuffer is structurally compatible with the DOM ImageData shape
// { width, height, data }, and every operation mutates `data` in place.

export type RGBA = { r: number; g: number; b: number; a: number };

export type PixelBuffer = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type BrushAction = { kind: "paint"; color: RGBA } | { kind: "erase" };

export type FillOptions = {
  // Max per-channel distance that still counts as a match against the seed color (0-255).
  tolerance?: number;
  // true (default) = flood fill only the contiguous region; false = replace every match.
  contiguous?: boolean;
};

const clamp255 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

export function createBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function inBounds(buffer: PixelBuffer, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < buffer.width && y < buffer.height;
}

export function getPixel(buffer: PixelBuffer, x: number, y: number): RGBA {
  if (!inBounds(buffer, x, y)) return { r: 0, g: 0, b: 0, a: 0 };
  const offset = (y * buffer.width + x) * 4;
  return {
    r: buffer.data[offset],
    g: buffer.data[offset + 1],
    b: buffer.data[offset + 2],
    a: buffer.data[offset + 3],
  };
}

export function setPixel(buffer: PixelBuffer, x: number, y: number, color: RGBA): void {
  if (!inBounds(buffer, x, y)) return;
  const offset = (y * buffer.width + x) * 4;
  buffer.data[offset] = clamp255(color.r);
  buffer.data[offset + 1] = clamp255(color.g);
  buffer.data[offset + 2] = clamp255(color.b);
  buffer.data[offset + 3] = clamp255(color.a);
}

// Max absolute per-channel difference; used for tolerance matching in fills/recolors.
export function colorDistance(a: RGBA, b: RGBA): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a));
}

export function colorClose(a: RGBA, b: RGBA, tolerance = 0): boolean {
  return colorDistance(a, b) <= tolerance;
}

// Source-over composite of a brush color onto the destination pixel.
function blendOver(dst: RGBA, src: RGBA): RGBA {
  const sa = src.a / 255;
  const da = dst.a / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (s: number, d: number) => (s * sa + d * da * (1 - sa)) / outA;
  return { r: mix(src.r, dst.r), g: mix(src.g, dst.g), b: mix(src.b, dst.b), a: outA * 255 };
}

function applyAction(buffer: PixelBuffer, x: number, y: number, action: BrushAction): boolean {
  if (!inBounds(buffer, x, y)) return false;
  if (action.kind === "erase") {
    setPixel(buffer, x, y, { r: 0, g: 0, b: 0, a: 0 });
    return true;
  }
  setPixel(buffer, x, y, blendOver(getPixel(buffer, x, y), action.color));
  return true;
}

// Stamp a filled disc of the given radius (radius 0 = a single pixel). Returns pixels touched.
export function stampCircle(buffer: PixelBuffer, cx: number, cy: number, radius: number, action: BrushAction): number {
  const r = Math.max(0, Math.round(radius));
  const centerX = Math.round(cx);
  const centerY = Math.round(cy);
  let changed = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      if (applyAction(buffer, centerX + dx, centerY + dy, action)) changed++;
    }
  }
  return changed;
}

// Bresenham line rasterization between two points, stamping along the way so fast
// pointer moves do not leave gaps in a stroke. Returns pixels touched (with overlap).
export function strokeLine(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  action: BrushAction
): number {
  const r = Math.max(0, Math.round(radius));
  let x = Math.round(x0);
  let y = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;
  let changed = 0;
  for (;;) {
    changed += stampCircle(buffer, x, y, r, action);
    if (x === endX && y === endY) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
  return changed;
}

// Flood fill (4-connected) from (x, y). Matches are measured against the seed color.
// With contiguous = false it becomes a global "replace every matching color" pass.
// Returns the number of pixels changed.
export function floodFill(buffer: PixelBuffer, x: number, y: number, fill: RGBA, options: FillOptions = {}): number {
  const tolerance = Math.max(0, options.tolerance ?? 0);
  const contiguous = options.contiguous ?? true;
  if (!inBounds(buffer, x, y)) return 0;
  const seed = getPixel(buffer, x, y);
  if (colorClose(seed, fill, 0)) return 0; // filling with the same color is a no-op

  const matches = (px: number, py: number) => colorClose(getPixel(buffer, px, py), seed, tolerance);

  if (!contiguous) {
    let changed = 0;
    for (let py = 0; py < buffer.height; py++) {
      for (let px = 0; px < buffer.width; px++) {
        if (matches(px, py)) {
          setPixel(buffer, px, py, fill);
          changed++;
        }
      }
    }
    return changed;
  }

  const visited = new Uint8Array(buffer.width * buffer.height);
  const start = y * buffer.width + x;
  const stack: number[] = [start];
  visited[start] = 1;
  let changed = 0;
  while (stack.length) {
    const index = stack.pop() as number;
    const px = index % buffer.width;
    const py = (index - px) / buffer.width;
    if (!matches(px, py)) continue;
    setPixel(buffer, px, py, fill);
    changed++;
    if (px > 0 && !visited[index - 1]) {
      visited[index - 1] = 1;
      stack.push(index - 1);
    }
    if (px < buffer.width - 1 && !visited[index + 1]) {
      visited[index + 1] = 1;
      stack.push(index + 1);
    }
    if (py > 0 && !visited[index - buffer.width]) {
      visited[index - buffer.width] = 1;
      stack.push(index - buffer.width);
    }
    if (py < buffer.height - 1 && !visited[index + buffer.width]) {
      visited[index + buffer.width] = 1;
      stack.push(index + buffer.width);
    }
  }
  return changed;
}

// Global palette recolor: replace every pixel within tolerance of `from` with `to`.
// This is the common pixel-art touch-up (swap one palette entry for another).
export function replaceColor(buffer: PixelBuffer, from: RGBA, to: RGBA, tolerance = 0): number {
  let changed = 0;
  for (let py = 0; py < buffer.height; py++) {
    for (let px = 0; px < buffer.width; px++) {
      if (colorClose(getPixel(buffer, px, py), from, tolerance)) {
        setPixel(buffer, px, py, to);
        changed++;
      }
    }
  }
  return changed;
}
