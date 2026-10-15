import type { CanvasSize, StudioCard } from "../types";

type Crop = StudioCard["assetCrop"];
type Placement = NonNullable<StudioCard["assetPlacement"]>;

function sourceRect(image: HTMLImageElement, crop: Crop) {
  const sx = Math.max(0, crop?.x ?? 0);
  const sy = Math.max(0, crop?.y ?? 0);
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, crop?.width ?? image.naturalWidth));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, crop?.height ?? image.naturalHeight));
  return { sx, sy, sw, sh };
}

export function renderStillAsset(
  canvas: HTMLCanvasElement,
  images: HTMLImageElement[],
  canvasSize: CanvasSize,
  crop: Crop,
  placement: Placement
) {
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  for (const image of images) {
    const { sx, sy, sw, sh } = sourceRect(image, crop);
    const fit = Math.min(canvas.width / sw, canvas.height / sh) * placement.scale;
    const width = sw * fit;
    const height = sh * fit;
    context.drawImage(
      image,
      sx,
      sy,
      sw,
      sh,
      (canvas.width - width) / 2 + placement.offsetX,
      (canvas.height - height) / 2 + placement.offsetY,
      width,
      height
    );
  }
}
