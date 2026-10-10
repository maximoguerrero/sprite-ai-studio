declare module "gifenc" {
  export type GifPalette = number[][];
  export type GifEncoder = {
    writeFrame(index: Uint8Array, width: number, height: number, options: {
      palette?: GifPalette;
      transparent?: boolean;
      transparentIndex?: number;
      delay?: number;
      repeat?: number;
      dispose?: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  const api: {
    GIFEncoder(): GifEncoder;
    applyPalette(data: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: string): Uint8Array;
    quantize(data: Uint8Array, maxColors: number, options?: { format?: string; oneBitAlpha?: boolean }): GifPalette;
  };
  export default api;
}
