import type { GenerationJob } from "../types";

export function generationJobLabel(job: GenerationJob): string {
  switch (job.target) {
    case "anchor":
      return "Project anchor";
    case "video-animation":
      return "Video clip generation";
    case "inbetween-frame":
      return "AI in-between frame";
    case "frame-edit":
      return "AI frame touch-up";
    case "animation-frame":
      return `Animation frame ${(job.frameIndex ?? 0) + 1}${job.cardId ? ` · ${job.cardId}` : ""}`;
    default:
      return "Asset generation";
  }
}
