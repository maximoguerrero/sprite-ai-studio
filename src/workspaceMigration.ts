import type { AnimationVersion, StudioFrame } from "./types";

export function normalizeFrameTiming<T extends Partial<StudioFrame>>(frame: T, fps: unknown): T & { durationMs: number } {
  const frameRate = Number(fps);
  const safeFps = Number.isFinite(frameRate) && frameRate > 0 ? Math.max(1, Math.floor(frameRate)) : 8;
  const duration = Number(frame.durationMs);
  return { ...frame, durationMs: Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.floor(duration)) : Math.max(1, Math.round(1000 / safeFps)) };
}

export function normalizeAnimationVersion(version: Record<string, unknown>, index: number, cardFps: unknown): AnimationVersion {
  const fpsValue = Number(version.fps);
  const cardFpsValue = Number(cardFps);
  const fps = Number.isFinite(fpsValue) && fpsValue > 0 ? Math.max(1, Math.floor(fpsValue)) : Number.isFinite(cardFpsValue) && cardFpsValue > 0 ? Math.max(1, Math.floor(cardFpsValue)) : 8;
  const numberValue = Number(version.number);
  const number = Number.isFinite(numberValue) && numberValue > 0 ? Math.max(1, Math.floor(numberValue)) : index + 1;
  const frames = Array.isArray(version.frames) ? version.frames.map((frame) => normalizeFrameTiming(frame as Partial<StudioFrame>, fps) as StudioFrame) : [];
  return { ...version, number, fps, frames } as unknown as AnimationVersion;
}
