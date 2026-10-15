export type AnimationStripCrop = { x: number; y: number; width: number; height: number };

export function animationStripCrop(
  sourceWidth: number,
  sourceHeight: number,
  frameIndex: number,
  frameCount = 8
): AnimationStripCrop {
  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth < frameCount ||
    sourceHeight < 1
  ) {
    throw new Error("The generated animation sheet has invalid dimensions.");
  }
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= frameCount) {
    throw new Error("The animation frame index is outside the sheet.");
  }
  const horizontalStrip = sourceWidth / sourceHeight >= frameCount * 0.9;
  const columns = horizontalStrip ? frameCount : 4;
  const rows = horizontalStrip ? 1 : Math.ceil(frameCount / columns);
  const cellWidth = sourceWidth / columns;
  const cellHeight = sourceHeight / rows;
  const cropSize = Math.min(cellWidth, cellHeight);
  const column = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  return {
    x: Math.round(column * cellWidth + (cellWidth - cropSize) / 2),
    y: Math.round(row * cellHeight + (cellHeight - cropSize) / 2),
    width: Math.round(cropSize),
    height: Math.round(cropSize),
  };
}
