(function attachMediaSourceUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MediaSourceUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const GLYPH_BY_MASK = new Uint8Array([14, 2, 1, 10, 4, 15, 9, 5, 3, 11, 16, 8, 12, 7, 6, 13]);
  const BAYER_2X2 = new Uint8Array([
    0, 2,
    3, 1,
  ]);
  const BAYER_4X4 = new Uint8Array([
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ]);
  const BAYER_8X8 = new Uint8Array([
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function computeSourceDraw(sourceWidth, sourceHeight, targetWidth, targetHeight, fit = "Cover") {
    const sw = Math.max(1, Number(sourceWidth) || 1);
    const sh = Math.max(1, Number(sourceHeight) || 1);
    const tw = Math.max(1, Number(targetWidth) || 1);
    const th = Math.max(1, Number(targetHeight) || 1);

    if (fit === "Contain") {
      const scale = Math.min(tw / sw, th / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      return { sx: 0, sy: 0, sw, sh, dx: (tw - dw) * 0.5, dy: (th - dh) * 0.5, dw, dh };
    }

    const sourceAspect = sw / sh;
    const targetAspect = tw / th;
    if (sourceAspect > targetAspect) {
      const cropWidth = sh * targetAspect;
      return { sx: (sw - cropWidth) * 0.5, sy: 0, sw: cropWidth, sh, dx: 0, dy: 0, dw: tw, dh: th };
    }
    const cropHeight = sw / targetAspect;
    return { sx: 0, sy: (sh - cropHeight) * 0.5, sw, sh: cropHeight, dx: 0, dy: 0, dw: tw, dh: th };
  }

  function sourceStrength(pixelData, index, invert, toneBias) {
    const pixel = index * 4;
    const alpha = pixelData[pixel + 3] / 255;
    const red = pixelData[pixel] * alpha + 255 * (1 - alpha);
    const green = pixelData[pixel + 1] * alpha + 255 * (1 - alpha);
    const blue = pixelData[pixel + 2] * alpha + 255 * (1 - alpha);
    const luminance = (77 * red + 150 * green + 29 * blue) / 256;
    return clamp((invert ? luminance : 255 - luminance) + toneBias, 0, 255);
  }

  function orderedMatrixForMode(mode) {
    if (mode === "Bayer 2×2") return { values: BAYER_2X2, size: 2 };
    if (mode === "Bayer 8×8") return { values: BAYER_8X8, size: 8 };
    if (mode === "Bayer 4×4" || mode === "Ordered Dither") return { values: BAYER_4X4, size: 4 };
    return null;
  }

  function addError(buffer, cols, rows, col, row, error) {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    buffer[row * cols + col] += error;
  }

  function diffuseError(buffer, cols, rows, col, row, error, mode, direction) {
    if (mode === "Floyd–Steinberg") {
      addError(buffer, cols, rows, col + direction, row, error * 7 / 16);
      addError(buffer, cols, rows, col - direction, row + 1, error * 3 / 16);
      addError(buffer, cols, rows, col, row + 1, error * 5 / 16);
      addError(buffer, cols, rows, col + direction, row + 1, error / 16);
      return;
    }
    addError(buffer, cols, rows, col + direction, row, error / 8);
    addError(buffer, cols, rows, col + direction * 2, row, error / 8);
    addError(buffer, cols, rows, col - direction, row + 1, error / 8);
    addError(buffer, cols, rows, col, row + 1, error / 8);
    addError(buffer, cols, rows, col + direction, row + 1, error / 8);
    addError(buffer, cols, rows, col, row + 2, error / 8);
  }

  function mapPixelsToGrid(pixelData, cols, rows, options = {}, output, workBuffer) {
    const count = Math.max(0, cols * rows);
    const result = output instanceof Uint8Array && output.length === count ? output : new Uint8Array(count);
    const mode = String(options.mode || "Threshold");
    const threshold = clamp(Number(options.threshold ?? 128), 0, 255);
    const toneBias = clamp(Number(options.toneBias) || 0, -100, 100);
    const invert = Boolean(options.invert);
    const ditherStrength = clamp(Number(options.ditherStrength ?? 100), 0, 100) / 100;
    const serpentine = options.serpentine !== false;
    const ordered = orderedMatrixForMode(mode);

    if (ordered) {
      for (let index = 0; index < count; index += 1) {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const matrixValue = ordered.values[(row % ordered.size) * ordered.size + (col % ordered.size)];
        const matrixThreshold = (matrixValue + 0.5) * 255 / (ordered.size * ordered.size);
        const cutoff = clamp(255 - threshold + (matrixThreshold - 127.5) * ditherStrength, 0, 255);
        result[index] = sourceStrength(pixelData, index, invert, toneBias) >= cutoff ? 1 : 0;
      }
      return result;
    }

    if (mode !== "Floyd–Steinberg" && mode !== "Atkinson") {
      const cutoff = 255 - threshold;
      for (let index = 0; index < count; index += 1) {
        result[index] = sourceStrength(pixelData, index, invert, toneBias) >= cutoff ? 1 : 0;
      }
      return result;
    }

    const work = workBuffer instanceof Float32Array && workBuffer.length === count
      ? workBuffer
      : new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      work[index] = sourceStrength(pixelData, index, invert, toneBias);
    }
    const cutoff = 255 - threshold;
    for (let row = 0; row < rows; row += 1) {
      const direction = serpentine && row % 2 === 1 ? -1 : 1;
      const start = direction === 1 ? 0 : cols - 1;
      const end = direction === 1 ? cols : -1;
      for (let col = start; col !== end; col += direction) {
        const index = row * cols + col;
        const value = clamp(work[index], 0, 255);
        const active = value >= cutoff;
        result[index] = active ? 1 : 0;
        const quantized = active ? 255 : 0;
        diffuseError(work, cols, rows, col, row, (value - quantized) * ditherStrength, mode, direction);
      }
    }
    return result;
  }

  function isCellActive(grid, cols, rows, col, row) {
    return col >= 0 && col < cols && row >= 0 && row < rows && grid[row * cols + col] !== 0;
  }

  function glyphForCell(grid, cols, rows, col, row) {
    const top = isCellActive(grid, cols, rows, col, row - 1);
    const right = isCellActive(grid, cols, rows, col + 1, row);
    const bottom = isCellActive(grid, cols, rows, col, row + 1);
    const left = isCellActive(grid, cols, rows, col - 1, row);
    const mask = (top ? 8 : 0) | (right ? 4 : 0) | (bottom ? 2 : 0) | (left ? 1 : 0);
    return GLYPH_BY_MASK[mask];
  }

  function buildGlyphIds(grid, cols, rows, output) {
    const count = Math.max(0, cols * rows);
    const result = output instanceof Uint8Array && output.length === count ? output : new Uint8Array(count);
    result.fill(0);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        if (grid[index]) result[index] = glyphForCell(grid, cols, rows, col, row);
      }
    }
    return result;
  }

  return {
    BAYER_2X2,
    BAYER_4X4,
    BAYER_8X8,
    GLYPH_BY_MASK,
    buildGlyphIds,
    computeSourceDraw,
    glyphForCell,
    isCellActive,
    mapPixelsToGrid,
  };
});
