import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { AnimationPhase, AnimationVersion, CanvasSize, StudioCard, StudioFrame, VideoVersion } from "../types";
import { activeFrameImageKey } from "../types";
import { deleteImages, loadImage, saveImage } from "../imageStore";
import {
  canvasPng,
  downloadBlob,
  encodeAnimatedWebp,
  encodeApng,
  encodeGif,
  frameImagePlacement,
  framesToZip,
  renderAnimationFrames,
  renderSheet,
  safeFilename,
  type FrameLayout,
} from "../spriteSheet";
import { normalizeFrameTiming } from "../workspaceMigration";
import { removeGreenScreen } from "../lib/imageUtils";
import { makeId } from "../lib/ids";
import { Dialog } from "./Dialog";
import { FrameTouchUpEditor } from "./FrameTouchUpEditor";
import { PhasePlannerForm } from "./PhasePlannerForm";

type ExtractedVideoFrame = { time: number; blob: Blob; url: string };

const DEFAULT_AI_TOUCH_UP_PROMPT =
  "Remove generation artifacts, clean stray pixels and jagged edges, and even out the palette.";

export function FrameEditor({
  card,
  canvasSize,
  onClose,
  onSave,
  onSaveAsSkill,
  onSaveCardSettings,
  onSavePromptAndPhases,
  onRewriteMotionPrompt,
  onRename,
  onGenerateAnimation,
  onGenerateVideo,
  onDeleteVideo,
  onGenerateInBetween,
  onRevertFrameEdit,
  onAiTouchUp,
  onSelectVersion,
  onDeleteVersion,
  onDelete,
}: {
  card: StudioCard;
  onClose: () => void;
  canvasSize: CanvasSize;
  onSave: (frames: StudioFrame[], fps: number, loop: boolean) => void;
  onSaveAsSkill: (settings: { fps: number; loop: boolean; frameCount: number }) => void;
  onSaveCardSettings: (settings: Partial<StudioCard>) => void;
  onSavePromptAndPhases: (prompt: string, phases: AnimationPhase[]) => void;
  onRewriteMotionPrompt: (current: { name: string; prompt: string }) => Promise<string>;
  onRename: (name: string) => void;
  onGenerateAnimation: () => void;
  onGenerateVideo: () => void;
  onDeleteVideo: (video: VideoVersion) => void;
  onGenerateInBetween: (before: StudioFrame, after: StudioFrame) => Promise<void>;
  onRevertFrameEdit: (frame: StudioFrame) => void;
  onAiTouchUp: (frame: StudioFrame, prompt: string) => void;
  onSelectVersion: (version: AnimationVersion) => void;
  onDeleteVersion: (version: AnimationVersion) => void;
  onDelete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [frames, setFrames] = useState<StudioFrame[]>(card.frames ?? []);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(card.videoVersions?.at(-1)?.id ?? null);
  const [videoSrc, setVideoSrc] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [extractSamples, setExtractSamples] = useState(card.videoSampleCount ?? 16);
  const [extractKeyOut, setExtractKeyOut] = useState(true);
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractMessage, setExtractMessage] = useState("");
  const [extractedFrames, setExtractedFrames] = useState<ExtractedVideoFrame[]>([]);
  const [extractSelection, setExtractSelection] = useState<number[]>([]);
  const [extractPreview, setExtractPreview] = useState<number | null>(null);
  const extractedUrls = useRef<string[]>([]);
  const lastExtractClick = useRef<number | null>(null);
  const activeVideo = (card.videoVersions ?? []).find((video) => video.id === activeVideoId);
  useEffect(() => {
    let revoke = "";
    let cancelled = false;
    if (!activeVideo) {
      setVideoSrc("");
      return;
    }
    void loadImage(activeVideo.imageKey).then((blob) => {
      if (cancelled || !blob) return;
      revoke = URL.createObjectURL(blob);
      setVideoSrc(revoke);
    });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [activeVideo?.imageKey]);
  useEffect(() => {
    extractedUrls.current.forEach(URL.revokeObjectURL);
    extractedUrls.current = [];
    setExtractedFrames([]);
    setExtractSelection([]);
    setExtractPreview(null);
    setExtractMessage("");
    lastExtractClick.current = null;
  }, [activeVideo?.imageKey]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const loadedFrameKeys = useRef(new Set<string>());
  const frameObjectUrls = useRef<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fps, setFps] = useState(card.fps ?? 8);
  const [loop, setLoop] = useState(card.loop ?? true);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draggedFrameId, setDraggedFrameId] = useState<string | null>(null);
  const [dropTargetFrameId, setDropTargetFrameId] = useState<string | null>(null);
  const [editingPivot, setEditingPivot] = useState(false);
  const [onionSkin, setOnionSkin] = useState(true);
  const [alignmentMode, setAlignmentMode] = useState<"manual" | "center" | "grounded" | "custom-pivot">("manual");
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0]);
  const [inBetweenSelection, setInBetweenSelection] = useState<string[]>([]);
  const [generatingInBetween, setGeneratingInBetween] = useState(false);
  const [sheetLayout, setSheetLayout] = useState<FrameLayout>("horizontal");
  const [sheetPadding, setSheetPadding] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<"checkerboard" | "solid" | "transparent">("checkerboard");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [pixelate, setPixelate] = useState(1);
  const [inspectDifference, setInspectDifference] = useState(false);
  const [differencePercent, setDifferencePercent] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [touchUpTarget, setTouchUpTarget] = useState<{ frameId: string; blob: Blob } | null>(null);
  const [aiTouchUpTarget, setAiTouchUpTarget] = useState<StudioFrame | null>(null);
  const [aiTouchUpPrompt, setAiTouchUpPrompt] = useState(DEFAULT_AI_TOUCH_UP_PROMPT);
  const [cardName, setCardName] = useState(card.name);
  const [editPrompt, setEditPrompt] = useState(card.prompt);
  const [editPhases, setEditPhases] = useState<AnimationPhase[]>(card.phases ?? []);
  const frameWidth = canvasSize.width;
  const frameHeight = canvasSize.height;
  const activeFrame = frames[activeIndex];
  const activeImageUrl = activeFrame ? imageUrls[activeFrameImageKey(activeFrame)] : undefined;
  const frameImageKeys = [
    ...new Set([
      ...(card.frames ?? []).map((frame) => activeFrameImageKey(frame)),
      ...frames.map((frame) => activeFrameImageKey(frame)),
    ]),
  ].join("\u0000");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      frameImageKeys
        .split("\u0000")
        .filter(Boolean)
        .map(async (imageKey) => {
          if (loadedFrameKeys.current.has(imageKey)) return;
          try {
            const blob = await loadImage(imageKey);
            if (!blob || cancelled) return;
            // Only mark the key as loaded once its object URL exists. Marking it
            // earlier breaks under React StrictMode (dev), which mounts, unmounts,
            // and remounts the effect before the async load resolves: the first
            // run would register the key, the remount would skip it, and the
            // cancelled first run would revoke the URL, leaving every thumbnail blank.
            const objectUrl = URL.createObjectURL(blob);
            loadedFrameKeys.current.add(imageKey);
            frameObjectUrls.current.push(objectUrl);
            setImageUrls((current) => ({ ...current, [imageKey]: objectUrl }));
          } catch {
            // Keep missing generated/imported images addressable for recovery in the frame strip.
          }
        })
    );
    return () => {
      cancelled = true;
    };
  }, [card.id, frameImageKeys]);

  useEffect(
    () => () => {
      frameObjectUrls.current.forEach(URL.revokeObjectURL);
      extractedUrls.current.forEach(URL.revokeObjectURL);
    },
    []
  );

  useEffect(() => {
    const incomingFrames = card.frames ?? [];
    const normalizedIncoming = incomingFrames.map((frame) => normalizeFrameTiming(frame, card.fps) as StudioFrame);
    if (JSON.stringify(normalizedIncoming) === JSON.stringify(frames)) return;
    setFrames(structuredClone(normalizedIncoming));
    setActiveIndex((index) => (incomingFrames.length ? Math.min(index, incomingFrames.length - 1) : 0));
  }, [card.frames]);

  useEffect(() => {
    setEditPrompt(card.prompt);
    setEditPhases(card.phases ?? []);
  }, [card.prompt, card.phases]);

  const saveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => onSave(frames, fps, loop), 120);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [frames, fps, loop]);
  const settingsSaveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = window.setTimeout(
      () => onSaveCardSettings({ frameCount: Math.max(1, frames.length), fps: Math.max(1, fps), loop }),
      120
    );
    return () => window.clearTimeout(settingsSaveTimerRef.current);
  }, [frames.length, fps, loop]);

  const openTouchUp = async (frame: StudioFrame) => {
    // The editor always starts from the original generated image; the edited copy
    // is a separate blob, so re-opening after a previous touch-up never stacks edits.
    const blob = await loadImage(frame.imageKey);
    if (!blob) {
      setMessage(`The original image for ${frame.name} is missing, so it cannot be touched up.`);
      return;
    }
    setTouchUpTarget({ frameId: frame.id, blob });
  };

  const handleTouchUpSave = async (png: Blob | null) => {
    const target = touchUpTarget;
    setTouchUpTarget(null);
    if (!png || !target) return;
    const frame = frames.find((item) => item.id === target.frameId);
    const editKey = `frame-edit-${target.frameId}-${makeId()}`;
    await saveImage(editKey, png);
    const objectUrl = URL.createObjectURL(png);
    loadedFrameKeys.current.add(editKey);
    frameObjectUrls.current.push(objectUrl);
    setImageUrls((current) => ({ ...current, [editKey]: objectUrl }));
    setFrames((current) =>
      current.map((item) => (item.id === target.frameId ? { ...item, editImageKey: editKey } : item))
    );
    if (frame?.editImageKey) void deleteImages([frame.editImageKey]);
    setMessage(`Saved touch-up for ${frame?.name ?? "frame"} as an edited copy.`);
  };

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    setAnimating(true);
    const timer = window.setInterval(
      () => {
        if (!loop && activeIndex >= frames.length - 1) {
          setPlaying(false);
          setAnimating(false);
          return;
        }
        setActiveIndex((index) => (loop ? (index + 1) % frames.length : Math.min(index + 1, frames.length - 1)));
      },
      1000 / Math.max(1, fps)
    );
    return () => window.clearInterval(timer);
  }, [playing, frames.length, activeIndex, fps, loop]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.imageSmoothingEnabled = false;
    if (!activeImageUrl || !activeFrame) {
      context.clearRect(0, 0, frameWidth, frameHeight);
      return;
    }
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.imageSmoothingEnabled = false;
    let cancelled = false;
    const drawFrame = async (frame: StudioFrame, url: string, opacity = 1) => {
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        return undefined;
      }
      return { frame, image, opacity };
    };
    void (async () => {
      const adjacent = onionSkin
        ? [frames[activeIndex - 1], frames[activeIndex + 1]].filter((frame): frame is StudioFrame =>
            Boolean(frame && imageUrls[activeFrameImageKey(frame)])
          )
        : [];
      const layers = await Promise.all([
        ...adjacent.map((frame) => drawFrame(frame, imageUrls[activeFrameImageKey(frame)], 0.22)),
        drawFrame(activeFrame, activeImageUrl),
      ]);
      if (cancelled) return;
      for (const layer of layers) {
        if (!layer) continue;
        const { frame, image, opacity } = layer;
        const placement = frameImagePlacement(frame, frameWidth, frameHeight, image.naturalWidth, image.naturalHeight);
        context.globalAlpha = opacity;
        context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
      }
      if (inspectDifference && !animating && frames.length > 1) {
        const following = frames[(activeIndex + 1) % frames.length];
        const followingLayer =
          following && imageUrls[activeFrameImageKey(following)]
            ? await drawFrame(following, imageUrls[activeFrameImageKey(following)])
            : undefined;
        if (followingLayer && !cancelled) {
          const difference = document.createElement("canvas");
          difference.width = frameWidth;
          difference.height = frameHeight;
          const differenceContext = difference.getContext("2d");
          if (differenceContext) {
            const placement = frameImagePlacement(
              followingLayer.frame,
              frameWidth,
              frameHeight,
              followingLayer.image.naturalWidth,
              followingLayer.image.naturalHeight
            );
            differenceContext.imageSmoothingEnabled = false;
            differenceContext.drawImage(
              followingLayer.image,
              placement.x,
              placement.y,
              placement.width,
              placement.height
            );
            const nextPixels = differenceContext.getImageData(0, 0, frameWidth, frameHeight).data;
            const activeDifference = document.createElement("canvas");
            activeDifference.width = frameWidth;
            activeDifference.height = frameHeight;
            const activeContext = activeDifference.getContext("2d");
            if (!activeContext) return;
            const activePlacement = frameImagePlacement(
              activeFrame,
              frameWidth,
              frameHeight,
              layers[layers.length - 1]!.image.naturalWidth,
              layers[layers.length - 1]!.image.naturalHeight
            );
            activeContext.imageSmoothingEnabled = false;
            activeContext.drawImage(
              layers[layers.length - 1]!.image,
              activePlacement.x,
              activePlacement.y,
              activePlacement.width,
              activePlacement.height
            );
            const currentPixels = activeContext.getImageData(0, 0, frameWidth, frameHeight).data;
            let changed = 0;
            for (let pixel = 0; pixel < nextPixels.length; pixel += 4)
              if (
                nextPixels[pixel] !== currentPixels[pixel] ||
                nextPixels[pixel + 1] !== currentPixels[pixel + 1] ||
                nextPixels[pixel + 2] !== currentPixels[pixel + 2] ||
                nextPixels[pixel + 3] !== currentPixels[pixel + 3]
              )
                changed += 1;
            setDifferencePercent(Math.round((changed / (frameWidth * frameHeight)) * 100));
            context.save();
            context.globalAlpha = 0.28;
            context.globalCompositeOperation = "difference";
            context.drawImage(difference, 0, 0);
            context.restore();
          }
        }
      } else setDifferencePercent(null);
      if (pixelate > 0) {
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(frameWidth / pixelate));
        small.height = Math.max(1, Math.round(frameHeight / pixelate));
        const smallContext = small.getContext("2d");
        if (smallContext) {
          smallContext.imageSmoothingEnabled = false;
          smallContext.drawImage(canvas, 0, 0, small.width, small.height);
          context.clearRect(0, 0, frameWidth, frameHeight);
          context.imageSmoothingEnabled = false;
          context.drawImage(small, 0, 0, frameWidth, frameHeight);
        }
      }
      context.globalAlpha = 1;
      context.strokeStyle = "rgba(201,243,106,.45)";
      context.lineWidth = Math.max(1, frameWidth / 128);
      context.beginPath();
      context.moveTo(frameWidth / 2, 0);
      context.lineTo(frameWidth / 2, frameHeight);
      context.moveTo(0, frameHeight * 0.9);
      context.lineTo(frameWidth, frameHeight * 0.9);
      context.stroke();
      context.fillStyle = editingPivot ? "#ffb454" : "#c9f36a";
      context.beginPath();
      context.arc(activeFrame.pivotX, activeFrame.pivotY, Math.max(1, frameWidth / 32), 0, Math.PI * 2);
      context.fill();
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeImageUrl,
    activeFrame,
    frames,
    imageUrls,
    activeIndex,
    frameWidth,
    frameHeight,
    editingPivot,
    onionSkin,
    inspectDifference,
    animating,
    pixelate,
  ]);

  function changeActiveFrame(update: (frame: StudioFrame) => StudioFrame) {
    setFrames((current) => current.map((frame, index) => (index === activeIndex ? update(frame) : frame)));
  }

  function reorderFrame(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const sourceIndex = frames.findIndex((frame) => frame.id === sourceId);
    const targetIndex = frames.findIndex((frame) => frame.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const activeFrameId = frames[activeIndex]?.id;
    const selectedFrameIds = new Set(
      selectedIndices.map((index) => frames[index]?.id).filter((id): id is string => Boolean(id))
    );
    const selectedInBetweenIds = new Set(inBetweenSelection);
    const reordered = [...frames];
    const [moving] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moving);
    setFrames(reordered);
    setActiveIndex(
      Math.max(
        0,
        reordered.findIndex((frame) => frame.id === activeFrameId)
      )
    );
    setSelectedIndices(reordered.flatMap((frame, index) => (selectedFrameIds.has(frame.id) ? [index] : [])));
    setInBetweenSelection(reordered.flatMap((frame) => (selectedInBetweenIds.has(frame.id) ? [frame.id] : [])));
    setMessage(
      `Moved ${moving.name || `frame ${sourceIndex + 1}`} to position ${reordered.findIndex((frame) => frame.id === moving.id) + 1}.`
    );
  }

  function toggleInBetweenFrame(frameId: string, checked: boolean) {
    setInBetweenSelection((current) => {
      if (!checked) return current.filter((id) => id !== frameId);
      if (current.length >= 2) {
        setMessage("Select no more than two frames for an in-between pose.");
        return current;
      }
      return [...current, frameId];
    });
  }

  function setCardThumbnail(frameId: string | null) {
    onSaveCardSettings({ thumbnailFrameId: frameId ?? undefined });
    const position = frameId ? frames.findIndex((frame) => frame.id === frameId) : -1;
    setMessage(
      frameId
        ? position >= 0
          ? `Frame ${position + 1} is now the card thumbnail.`
          : "Card thumbnail updated."
        : "Card thumbnail cleared."
    );
  }

  async function importFrames(files: FileList | File[] | null) {
    if (!files) return;
    const nextFrames: StudioFrame[] = [];
    const nextUrls: Record<string, string> = {};
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const imageKey = `frame-${makeId()}`;
      try {
        await saveImage(imageKey, file);
        const frame: StudioFrame = {
          id: makeId(),
          imageKey,
          name: file.name,
          offsetX: 0,
          offsetY: 0,
          pivotX: frameWidth / 2,
          pivotY: frameHeight * 0.9,
          durationMs: Math.round(1000 / Math.max(1, fps)),
        };
        nextFrames.push(frame);
        nextUrls[imageKey] = URL.createObjectURL(file);
      } catch {
        setMessage("Could not store imported frames in this browser. Check local storage availability.");
      }
    }
    if (nextFrames.length) {
      setFrames((current) => [...current, ...nextFrames]);
      setImageUrls((current) => ({ ...current, ...nextUrls }));
      setActiveIndex(frames.length);
      setSelectedIndices([frames.length]);
      setMessage(`${nextFrames.length} frame${nextFrames.length === 1 ? "" : "s"} imported.`);
    }
  }

  async function importImageBlobs(blobs: Blob[]) {
    const files = blobs.map(
      (blob, index) =>
        new File([blob], `pasted-frame-${Date.now()}-${index + 1}.png`, { type: blob.type || "image/png" })
    );
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    await importFrames(transfer.files);
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.read) {
      setMessage(
        "Clipboard image access is not available here. Copy an image, then use Ctrl/Cmd+V while this editor is open."
      );
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const blobs: Blob[] = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) blobs.push(await item.getType(imageType));
      }
      if (blobs.length) await importImageBlobs(blobs);
      else setMessage("No image found on the clipboard.");
    } catch {
      setMessage("Clipboard access was denied. Copy an image and press Ctrl/Cmd+V in the editor.");
    }
  }

  async function extractVideoFrames() {
    const video = videoRef.current;
    if (!video || !videoSrc || !Number.isFinite(video.duration) || !video.videoWidth || !video.videoHeight) {
      setExtractMessage("The clip is not ready for extraction. This webview may not decode the video codec.");
      return;
    }
    setExtractBusy(true);
    setExtractMessage("");
    video.pause();
    const samples: ExtractedVideoFrame[] = [];
    const sampleCount =
      extractSamples > 0 ? extractSamples : Math.min(240, Math.max(1, Math.round(video.duration * fps)));
    try {
      for (let index = 0; index < sampleCount; index += 1) {
        const time = Math.min((video.duration * index) / sampleCount, video.duration - 0.001);
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = time;
        });
        const canvas = document.createElement("canvas");
        canvas.width = frameWidth;
        canvas.height = frameHeight;
        const context = canvas.getContext("2d");
        if (!context) break;
        context.imageSmoothingEnabled = false;
        const scale = Math.min(frameWidth / video.videoWidth, frameHeight / video.videoHeight);
        const width = video.videoWidth * scale;
        const height = video.videoHeight * scale;
        context.drawImage(video, (frameWidth - width) / 2, (frameHeight - height) / 2, width, height);
        let blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (frameBlob) => (frameBlob ? resolve(frameBlob) : reject(new Error("Could not encode an extracted frame."))),
            "image/png"
          )
        );
        if (extractKeyOut) blob = await removeGreenScreen(blob);
        const url = URL.createObjectURL(blob);
        extractedUrls.current.push(url);
        samples.push({ time, blob, url });
      }
      setExtractedFrames(samples);
      setExtractSelection([]);
      setExtractPreview(samples.length ? 0 : null);
      lastExtractClick.current = null;
      setExtractMessage(
        `Sampled ${samples.length} frames from ${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(2)}s${extractSamples === 0 ? ` (all frames at ${fps} fps)` : ""}. Click thumbnails to choose frames; Shift-click selects the range between clicks.`
      );
    } catch (error) {
      setExtractMessage(error instanceof Error ? error.message : "Frame extraction failed in this webview.");
    } finally {
      setExtractBusy(false);
    }
  }

  function toggleExtractedFrame(index: number, shiftKey = false) {
    setExtractPreview(index);
    if (shiftKey && lastExtractClick.current !== null) {
      const [from, to] = [Math.min(lastExtractClick.current, index), Math.max(lastExtractClick.current, index)];
      const range = Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
      setExtractSelection((current) => [...new Set([...current, ...range])]);
      return;
    }
    lastExtractClick.current = index;
    setExtractSelection((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    );
  }

  async function addSelectedExtractedFrames() {
    const chosen = extractSelection
      .map((index) => extractedFrames[index])
      .filter((frame): frame is ExtractedVideoFrame => Boolean(frame));
    if (!chosen.length) {
      setExtractMessage("Select at least one extracted frame to add to the timeline.");
      return;
    }
    setExtractBusy(true);
    const nextFrames: StudioFrame[] = [];
    const nextUrls: Record<string, string> = {};
    try {
      for (const sample of chosen) {
        const imageKey = `frame-${makeId()}`;
        await saveImage(imageKey, sample.blob);
        nextFrames.push({
          id: makeId(),
          imageKey,
          name: `video-frame-${String(nextFrames.length + 1).padStart(2, "0")}`,
          offsetX: 0,
          offsetY: 0,
          pivotX: frameWidth / 2,
          pivotY: frameHeight * 0.9,
          durationMs: Math.round(1000 / Math.max(1, fps)),
        });
        const objectUrl = URL.createObjectURL(sample.blob);
        frameObjectUrls.current.push(objectUrl);
        loadedFrameKeys.current.add(imageKey);
        nextUrls[imageKey] = objectUrl;
      }
      setFrames((current) => [...current, ...nextFrames]);
      setImageUrls((current) => ({ ...current, ...nextUrls }));
      setActiveIndex(frames.length);
      setSelectedIndices([frames.length]);
      setExtractSelection([]);
      lastExtractClick.current = null;
      setExtractMessage(`Added ${nextFrames.length} video frame${nextFrames.length === 1 ? "" : "s"} to the timeline.`);
    } catch (error) {
      setExtractMessage(error instanceof Error ? error.message : "Could not store the selected video frames.");
    } finally {
      setExtractBusy(false);
    }
  }

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName)))
        return;
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!images.length) return;
      event.preventDefault();
      void importFrames(images);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [frameWidth]);

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (!activeFrame) return;
    if (editingPivot) {
      const rect = event.currentTarget.getBoundingClientRect();
      changeActiveFrame((frame) => ({
        ...frame,
        pivotX: Math.round(((event.clientX - rect.left) * frameWidth) / rect.width),
        pivotY: Math.round(((event.clientY - rect.top) * frameHeight) / rect.height),
      }));
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function dragSprite(event: PointerEvent<HTMLCanvasElement>) {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (editingPivot) {
      changeActiveFrame((frame) => ({
        ...frame,
        pivotX: Math.max(0, Math.min(frameWidth, Math.round(((event.clientX - rect.left) * frameWidth) / rect.width))),
        pivotY: Math.max(
          0,
          Math.min(frameHeight, Math.round(((event.clientY - rect.top) * frameHeight) / rect.height))
        ),
      }));
      return;
    }
    const scale = frameWidth / rect.width;
    changeActiveFrame((frame) => ({
      ...frame,
      offsetX: Math.round(frame.offsetX + event.movementX * scale),
      offsetY: Math.round(frame.offsetY + event.movementY * scale),
    }));
  }

  function nudge(dx: number, dy: number) {
    changeActiveFrame((frame) => ({ ...frame, offsetX: frame.offsetX + dx, offsetY: frame.offsetY + dy }));
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !(event.target instanceof HTMLElement) ||
        event.target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      )
        return;
      const amount = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudge(-amount, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudge(amount, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        nudge(0, -amount);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudge(0, amount);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex]);

  async function alignFrame() {
    if (!activeFrame || !activeImageUrl) return;
    if (alignmentMode === "custom-pivot") {
      changeActiveFrame((frame) => ({
        ...frame,
        offsetX: Math.round(frame.offsetX + frameWidth / 2 - frame.pivotX - frame.offsetX),
        offsetY: Math.round(frame.offsetY + frameHeight / 2 - frame.pivotY - frame.offsetY),
      }));
      return;
    }
    const image = new Image();
    image.src = activeImageUrl;
    try {
      await image.decode();
    } catch {
      return;
    }
    const boundsCanvas = document.createElement("canvas");
    boundsCanvas.width = image.naturalWidth;
    boundsCanvas.height = image.naturalHeight;
    const boundsContext = boundsCanvas.getContext("2d", { willReadFrequently: true });
    if (!boundsContext) return;
    boundsContext.drawImage(image, 0, 0);
    const pixels = boundsContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data;
    let minX = image.naturalWidth,
      minY = image.naturalHeight,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < image.naturalHeight; y++)
      for (let x = 0; x < image.naturalWidth; x++) {
        if (pixels[(y * image.naturalWidth + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    if (maxX < 0) {
      minX = 0;
      minY = 0;
      maxX = image.naturalWidth - 1;
      maxY = image.naturalHeight - 1;
    }
    const scale =
      Math.min(frameWidth / image.naturalWidth, frameHeight / image.naturalHeight) * (activeFrame.scale ?? 1);
    const imageLeft = (frameWidth - image.naturalWidth * scale) / 2;
    const imageTop = (frameHeight - image.naturalHeight * scale) / 2;
    const left = imageLeft + minX * scale + activeFrame.offsetX;
    const top = imageTop + minY * scale + activeFrame.offsetY;
    const width = (maxX - minX + 1) * scale;
    const height = (maxY - minY + 1) * scale;
    const targetX = frameWidth / 2;
    const targetY = alignmentMode === "grounded" ? frameHeight * 0.9 : frameHeight / 2;
    const spriteX = left + width / 2;
    const spriteY = alignmentMode === "grounded" ? top + height : top + height / 2;
    changeActiveFrame((frame) => ({
      ...frame,
      offsetX: Math.round(frame.offsetX + targetX - spriteX),
      offsetY: Math.round(frame.offsetY + targetY - spriteY),
    }));
  }

  function matchPrevious() {
    const previous = frames[activeIndex - 1];
    if (previous)
      changeActiveFrame((frame) => ({
        ...frame,
        offsetX: previous.offsetX,
        offsetY: previous.offsetY,
        scale: previous.scale ?? 1,
      }));
  }

  function applyPlacementToSelected() {
    if (!activeFrame) return;
    const targets = new Set(selectedIndices.filter((index) => index !== activeIndex));
    setFrames((current) =>
      current.map((frame, index) =>
        targets.has(index)
          ? { ...frame, offsetX: activeFrame.offsetX, offsetY: activeFrame.offsetY, scale: activeFrame.scale ?? 1 }
          : frame
      )
    );
  }

  async function generateBetweenSelected() {
    if (inBetweenSelection.length !== 2) {
      setMessage("Check exactly two timeline frames to generate an in-between pose.");
      return;
    }
    const [before, after] = inBetweenSelection.map((id) => frames.find((frame) => frame.id === id));
    if (!before || !after || after === before) return;
    setGeneratingInBetween(true);
    try {
      await onGenerateInBetween(before, after);
    } finally {
      setGeneratingInBetween(false);
    }
  }

  async function loadExportFrames() {
    return Promise.all(
      frames.map(async (frame) => {
        const blob = await loadImage(activeFrameImageKey(frame));
        if (!blob) throw new Error(`Missing frame image: ${frame.name}`);
        const image = new Image();
        const url = URL.createObjectURL(blob);
        image.src = url;
        try {
          await image.decode();
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
        return { ...frame, image, sourceUrl: url };
      })
    );
  }

  async function exportCardSheet() {
    setExportBusy(true);
    let exportFrames: Awaited<ReturnType<typeof loadExportFrames>> = [];
    try {
      exportFrames = await loadExportFrames();
      const columns = sheetLayout === "horizontal" ? exportFrames.length : Math.ceil(Math.sqrt(exportFrames.length));
      const { canvas, atlasFrames } = renderSheet(exportFrames, frameWidth, frameHeight, columns, sheetPadding);
      const sheetBlob = await canvasPng(canvas);
      const base = safeFilename(card.name);
      downloadBlob(sheetBlob, `${base}-spritesheet.png`);
      const activeVersion = card.versions?.find((version) => version.id === card.activeVersionId);
      const atlas = {
        schema: "sprite-studio-atlas/v1",
        meta: {
          app: "Sprite Studio",
          format: "RGBA8888",
          size: { width: canvas.width, height: canvas.height },
          scale: 1,
        },
        animations: [
          {
            id: card.id,
            name: card.name,
            cardVersionId: activeVersion?.id,
            anchorVersionId: activeVersion?.anchorVersionId ?? card.anchorVersionId,
            fps,
            loop,
            frameWidth,
            frameHeight,
            layout: sheetLayout,
            padding: sheetPadding,
            frames: atlasFrames,
          },
        ],
      };
      downloadBlob(new Blob([JSON.stringify(atlas, null, 2)], { type: "application/json" }), `${base}-atlas.json`);
      setMessage(`Sprite sheet (${sheetLayout}, ${sheetPadding}px padding) and atlas exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      exportFrames.forEach((frame) => URL.revokeObjectURL(frame.sourceUrl));
      setExportBusy(false);
    }
  }

  async function exportFrameZip() {
    setExportBusy(true);
    let exportFrames: Awaited<ReturnType<typeof loadExportFrames>> = [];
    try {
      exportFrames = await loadExportFrames();
      const files = await Promise.all(
        exportFrames.map(async (frame, index) => ({
          name: `${String(index + 1).padStart(3, "0")}-${safeFilename(frame.name)}.png`,
          data: new Uint8Array(
            await (await canvasPng(renderSheet([frame], frameWidth, frameHeight, 1).canvas)).arrayBuffer()
          ),
        }))
      );
      const archive = framesToZip(files);
      downloadBlob(new Blob([archive], { type: "application/zip" }), `${safeFilename(card.name)}-frames.zip`);
      setMessage(`${files.length} normalized PNG frames exported as ZIP.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Frame ZIP export failed.");
    } finally {
      exportFrames.forEach((frame) => URL.revokeObjectURL(frame.sourceUrl));
      setExportBusy(false);
    }
  }

  async function exportAnimation(format: "gif" | "webp" | "apng") {
    setExportBusy(true);
    let exportFrames: Awaited<ReturnType<typeof loadExportFrames>> = [];
    try {
      exportFrames = await loadExportFrames();
      const normalizedFrames = renderAnimationFrames(exportFrames, frameWidth, frameHeight);
      const base = safeFilename(card.name);
      if (format === "gif")
        downloadBlob(new Blob([encodeGif(normalizedFrames, loop)], { type: "image/gif" }), `${base}.gif`);
      else if (format === "apng")
        downloadBlob(new Blob([encodeApng(normalizedFrames, loop)], { type: "image/apng" }), `${base}.apng.png`);
      else
        downloadBlob(
          new Blob([await encodeAnimatedWebp(normalizedFrames, loop)], { type: "image/webp" }),
          `${base}.webp`
        );
      setMessage(`${format.toUpperCase()} animation exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${format.toUpperCase()} export failed.`);
    } finally {
      exportFrames.forEach((frame) => URL.revokeObjectURL(frame.sourceUrl));
      setExportBusy(false);
    }
  }

  async function exportCurrentFrame() {
    if (!activeFrame) return;
    const framesForSheet = frames.slice(activeIndex, activeIndex + 1);
    const blob = await loadImage(activeFrameImageKey(activeFrame));
    if (!blob) return setMessage("This frame image is missing from local storage.");
    const image = new Image();
    image.src = URL.createObjectURL(blob);
    await image.decode();
    const { canvas } = renderSheet([{ ...framesForSheet[0], image }], frameWidth, frameHeight, 1);
    URL.revokeObjectURL(image.src);
    downloadBlob(
      await canvasPng(canvas),
      `${safeFilename(card.name)}-frame-${String(activeIndex + 1).padStart(2, "0")}.png`
    );
  }

  return (
    <section className="editor-page">
      <div className="editor-topline">
        <button className="text-button" onClick={onClose}>
          ← Back to project
        </button>
        <span className="tag">ANIMATION CARD</span>
        <button className="button destructive-button" onClick={onDelete}>
          Delete animation
        </button>
      </div>
      <div className="editor-heading">
        <div>
          <div className="eyebrow">FRAME EDITOR</div>
          <div className="editor-title-row">
            <h1>{card.name}</h1>
            <button
              className="icon-button rename-card-button"
              aria-label="Rename animation card"
              title="Rename card"
              onClick={() => {
                setCardName(card.name);
                setRenameOpen(true);
              }}
            >
              ✎
            </button>
          </div>
        </div>
        <div className="editor-actions">
          <button className="button secondary" onClick={() => fileInputRef.current?.click()}>
            ↑ Import frames
          </button>
          <button className="button secondary" onClick={() => void pasteFromClipboard()}>
            ▣ Paste frame
          </button>
          <input
            ref={fileInputRef}
            className="hidden-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => {
              void importFrames(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <button className="button secondary" onClick={() => onSaveAsSkill({ fps, loop, frameCount: frames.length })}>
            Save as skill
          </button>
          <button className="button secondary" onClick={onGenerateAnimation}>
            Generate 8-frame sheet
          </button>
          <button className="button secondary" onClick={onGenerateVideo}>
            Animate with video
          </button>
          <button
            className="button secondary"
            disabled={!frames.length || exportBusy}
            onClick={() => void exportCardSheet()}
          >
            Export card sheet
          </button>
        </div>
      </div>
      {(card.versions?.length ?? 0) > 0 && (
        <div className="animation-version-strip">
          <span>Versions</span>
          {card.versions?.map((version) => (
            <span key={version.id} className="animation-version-cell">
              <button
                className={version.id === card.activeVersionId ? "animation-version active" : "animation-version"}
                aria-pressed={version.id === card.activeVersionId}
                onClick={() => onSelectVersion(version)}
              >
                <strong>
                  v{version.number}
                  {version.id === card.activeVersionId ? " · current" : ""}
                </strong>
                <small>
                  {version.frames.length} frames · {version.fps} FPS
                </small>
              </button>
              <button
                type="button"
                className="version-delete"
                aria-label={`Delete version ${version.number}`}
                title={`Delete version ${version.number}`}
                onClick={() => onDeleteVersion(version)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {(card.videoVersions?.length ?? 0) > 0 && (
        <div className="video-clip-strip">
          <div className="video-clip-row">
            <div className="video-clip-list">
              <span>Video clips</span>
              {card.videoVersions?.map((video, index) => (
                <span key={video.id} className="animation-version-cell">
                  <button
                    className={video.id === activeVideoId ? "animation-version active" : "animation-version"}
                    aria-pressed={video.id === activeVideoId}
                    onClick={() => setActiveVideoId(video.id)}
                  >
                    <strong>
                      Clip {index + 1}
                      {video.id === activeVideoId ? " · current" : ""}
                    </strong>
                    <small>
                      {video.duration}s · {video.model.replace("grok-imagine-video", "Grok")}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="version-delete"
                    aria-label={`Delete clip ${index + 1}`}
                    title={`Delete clip ${index + 1}`}
                    onClick={() => onDeleteVideo(video)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {videoSrc && (
              <div className="video-clip-player-frame">
                <video ref={videoRef} className="video-clip-player" src={videoSrc} controls muted loop playsInline />
              </div>
            )}
          </div>
          {videoSrc && (
            <div className="video-extract-panel">
              <div className="video-extract-controls">
                <span className="eyebrow">FRAME EXTRACTION</span>
                <label>
                  Samples
                  <select
                    value={extractSamples}
                    disabled={extractBusy}
                    onChange={(event) => setExtractSamples(Number(event.target.value))}
                  >
                    <option value={0}>All frames</option>
                    <option value={8}>8</option>
                    <option value={12}>12</option>
                    <option value={16}>16</option>
                    <option value={24}>24</option>
                  </select>
                </label>
                <label className="onion-toggle">
                  <input
                    type="checkbox"
                    checked={extractKeyOut}
                    onChange={(event) => setExtractKeyOut(event.target.checked)}
                  />{" "}
                  Remove green screen
                </label>
                <button className="button secondary" disabled={extractBusy} onClick={() => void extractVideoFrames()}>
                  {extractBusy ? "Extracting…" : "Extract frames"}
                </button>
                <button
                  className="button primary"
                  disabled={extractBusy || !extractSelection.length}
                  onClick={() => void addSelectedExtractedFrames()}
                >
                  Add selected to frames
                </button>
                <button
                  className="text-button"
                  disabled={!extractedFrames.length}
                  onClick={() => {
                    setExtractSelection(extractedFrames.map((_, index) => index));
                    lastExtractClick.current = null;
                  }}
                >
                  Select all
                </button>
                <button
                  className="text-button"
                  disabled={!extractSelection.length}
                  onClick={() => {
                    setExtractSelection([]);
                    lastExtractClick.current = null;
                  }}
                >
                  Clear
                </button>
                <span className="video-extract-count">{extractSelection.length} selected</span>
              </div>
              {extractedFrames.length > 0 && (
                <div className="video-extract-body">
                  <div className="video-extract-strip" aria-label="Extracted video frame samples">
                    {extractedFrames.map((frame, index) => (
                      <button
                        key={frame.url}
                        type="button"
                        className={
                          extractSelection.includes(index) ? "video-extract-thumb selected" : "video-extract-thumb"
                        }
                        aria-pressed={extractSelection.includes(index)}
                        onClick={(event) => toggleExtractedFrame(index, event.shiftKey)}
                      >
                        <img src={frame.url} alt={`Extracted frame ${index + 1} at ${frame.time.toFixed(2)}s`} />
                        <small>
                          {index + 1} · {frame.time.toFixed(1)}s
                        </small>
                      </button>
                    ))}
                  </div>
                  {extractPreview !== null && extractedFrames[extractPreview] && (
                    <div className="video-extract-preview">
                      <span>
                        Preview · {frameWidth} × {frameHeight}
                      </span>
                      <div className="video-extract-preview-canvas checkerboard">
                        <img
                          src={extractedFrames[extractPreview].url}
                          alt="Selected extracted frame at card canvas size"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {extractMessage && (
                <p className="editor-message" role="status">
                  {extractMessage}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {renameOpen && (
        <Dialog title="Rename animation card" onClose={() => setRenameOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = cardName.trim();
              if (name) onRename(name);
              setRenameOpen(false);
            }}
          >
            <label>
              Card name
              <input autoFocus value={cardName} onChange={(event) => setCardName(event.target.value)} required />
            </label>
            <div className="dialog-actions">
              <button className="button secondary" type="button" onClick={() => setRenameOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="submit">
                Save name
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {touchUpTarget ? (
        <FrameTouchUpEditor
          title={frames.find((frame) => frame.id === touchUpTarget.frameId)?.name ?? "frame"}
          source={touchUpTarget.blob}
          onClose={() => setTouchUpTarget(null)}
          onSave={handleTouchUpSave}
        />
      ) : null}
      {aiTouchUpTarget ? (
        <Dialog title={`AI touch up “${aiTouchUpTarget.name}”`} onClose={() => setAiTouchUpTarget(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const instruction = aiTouchUpPrompt.trim();
              if (instruction) onAiTouchUp(aiTouchUpTarget, instruction);
              setAiTouchUpTarget(null);
            }}
          >
            <label>
              What should the model fix?
              <textarea
                autoFocus
                rows={4}
                value={aiTouchUpPrompt}
                onChange={(event) => setAiTouchUpPrompt(event.target.value)}
                required
              />
            </label>
            <p className="storage-note">
              The frame is sent to your image provider and may incur charges. The result is saved as an edited copy; the
              original generated frame is kept and can be restored with revert.
            </p>
            <div className="dialog-actions">
              <button className="button secondary" type="button" onClick={() => setAiTouchUpTarget(null)}>
                Cancel
              </button>
              <button className="button primary" type="submit">
                Send to provider
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
      <PhasePlannerForm
        prompt={editPrompt}
        phases={editPhases}
        onPromptChange={setEditPrompt}
        onPhasesChange={setEditPhases}
        onSave={onSavePromptAndPhases}
        onRewritePrompt={onRewriteMotionPrompt}
        cardName={card.name}
        videoSettings={{
          loopPreset: card.videoLoopPreset ?? "generic",
          duration: card.videoDuration ?? 4,
          sampleCount: extractSamples,
          pinLoop: Boolean(card.videoPinLoop),
        }}
        onVideoSettingsChange={(patch) => {
          if (patch.videoSampleCount !== undefined) setExtractSamples(patch.videoSampleCount);
          onSaveCardSettings(patch);
        }}
      />

      <div className="editor-layout">
        <div className="editor-main-column">
          <section className="preview-panel editor-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">PREVIEW</span>
                <span className="preview-resolution">
                  {frameWidth} × {frameHeight}
                </span>
              </div>
              <div className="playback-tools">
                <button
                  className="small-tool"
                  onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}
                  disabled={!frames.length}
                >
                  ‹
                </button>
                <button
                  className="play-button"
                  onClick={() => {
                    if (activeIndex === frames.length - 1 && !loop) setActiveIndex(0);
                    setPlaying(!playing);
                  }}
                  disabled={frames.length < 2}
                >
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <button
                  className="small-tool"
                  onClick={() => setActiveIndex(Math.min(frames.length - 1, activeIndex + 1))}
                  disabled={!frames.length}
                >
                  ›
                </button>
              </div>
            </div>
            <div className="preview-canvas-controls">
              <label>
                Background{" "}
                <select
                  value={previewBackground}
                  onChange={(event) => setPreviewBackground(event.target.value as typeof previewBackground)}
                >
                  <option value="checkerboard">Checkerboard</option>
                  <option value="solid">Solid</option>
                  <option value="transparent">Transparent</option>
                </select>
              </label>
              <button aria-label="Zoom out" onClick={() => setPreviewZoom((zoom) => Math.max(1, zoom / 2))}>
                −
              </button>
              <span>{previewZoom}×</span>
              <button aria-label="Zoom in" onClick={() => setPreviewZoom((zoom) => Math.min(8, zoom * 2))}>
                ＋
              </button>
              <button onClick={() => setPreviewZoom(1)}>Native size</button>
              <label className="frame-difference">
                <input
                  type="checkbox"
                  checked={inspectDifference}
                  onChange={(event) => setInspectDifference(event.target.checked)}
                />{" "}
                Difference
              </label>
              <button
                disabled={!frames.length}
                onClick={() => {
                  setPlaying(false);
                  setAnimating(false);
                  setActiveIndex(frames.length - 1);
                  setInspectDifference(true);
                }}
              >
                Loop seam
              </button>
              {differencePercent !== null && <span>{differencePercent}% changed</span>}
            </div>
            <div className="frame-alignment-tools">
              <label>
                Alignment mode
                <select
                  disabled={!activeFrame}
                  value={alignmentMode}
                  onChange={(event) => setAlignmentMode(event.target.value as typeof alignmentMode)}
                >
                  <option value="manual">Manual</option>
                  <option value="center">Canvas center</option>
                  <option value="grounded">Grounded / baseline</option>
                  <option value="custom-pivot">Custom pivot</option>
                </select>
              </label>
              <button
                className="text-button"
                disabled={!activeFrame || alignmentMode === "manual"}
                onClick={() => void alignFrame()}
              >
                Align frame
              </button>
              <button className="text-button" disabled={!activeFrame || activeIndex === 0} onClick={matchPrevious}>
                Match previous
              </button>
              <button
                className={editingPivot ? "text-button pivot-active" : "text-button"}
                disabled={!activeFrame}
                onClick={() => setEditingPivot((value) => !value)}
              >
                {editingPivot ? "Done editing pivot" : "Edit pivot"}
              </button>
              <label className="onion-toggle">
                <input type="checkbox" checked={onionSkin} onChange={(event) => setOnionSkin(event.target.checked)} />{" "}
                Onion skin
              </label>
            </div>
            <div className="placement-selection-tools">
              <span>Apply placement to:</span>
              {frames.map((frame, index) => (
                <label key={frame.id}>
                  <input
                    type="checkbox"
                    checked={selectedIndices.includes(index)}
                    onChange={(event) =>
                      setSelectedIndices((current) =>
                        event.target.checked ? [...current, index] : current.filter((item) => item !== index)
                      )
                    }
                  />
                  {index + 1}
                </label>
              ))}
              <button
                className="text-button"
                disabled={!activeFrame || selectedIndices.every((index) => index === activeIndex)}
                onClick={applyPlacementToSelected}
              >
                Apply to selected
              </button>
            </div>
            <div className={`editor-canvas-wrap ${previewBackground}-preview`}>
              <div
                className={`editor-canvas ${previewBackground === "checkerboard" ? "checkerboard" : ""} ${previewZoom > 1 ? "zoomed-preview" : ""}`}
              >
                <canvas
                  style={{ width: `${Math.min(800, 100 * previewZoom)}%`, height: "auto", imageRendering: "pixelated" }}
                  ref={canvasRef}
                  onPointerDown={startDrag}
                  onPointerMove={dragSprite}
                  onPointerUp={() => setDragging(false)}
                  onPointerCancel={() => setDragging(false)}
                  className={activeFrame ? "draggable-canvas" : ""}
                  aria-label={
                    editingPivot ? "Click or drag to set frame pivot" : "Sprite frame preview; drag to recenter"
                  }
                />
                {!frames.length && (
                  <div className="canvas-empty">
                    <span>＋</span>
                    <strong>Import animation frames</strong>
                    <small>PNG, JPG, or WebP</small>
                  </div>
                )}
              </div>
            </div>
            <div className="align-tools">
              <div className="align-label">
                <strong>Placement</strong>
                <span>{editingPivot ? "Click or drag to move pivot" : "Drag or use arrow keys · Shift = 10 px"}</span>
              </div>
              <div className="nudge-pad">
                <button onClick={() => nudge(0, -1)} disabled={!activeFrame} aria-label="Nudge up">
                  ↑
                </button>
                <button onClick={() => nudge(-1, 0)} disabled={!activeFrame} aria-label="Nudge left">
                  ←
                </button>
                <button onClick={() => nudge(0, 1)} disabled={!activeFrame} aria-label="Nudge down">
                  ↓
                </button>
                <button onClick={() => nudge(1, 0)} disabled={!activeFrame} aria-label="Nudge right">
                  →
                </button>
              </div>
              <div className="offset-readout">
                {activeFrame ? `X ${activeFrame.offsetX} · Y ${activeFrame.offsetY}` : "X 0 · Y 0"}
              </div>
              <label className="frame-scale-control">
                Scale{" "}
                <div className="input-suffix">
                  <input
                    type="number"
                    aria-label="Frame scale"
                    min="0.1"
                    max="8"
                    step="0.05"
                    value={activeFrame?.scale ?? 1}
                    disabled={!activeFrame}
                    onChange={(event) =>
                      activeFrame &&
                      changeActiveFrame((frame) => ({
                        ...frame,
                        scale: Math.max(0.1, Math.min(8, Number(event.target.value) || 0.1)),
                      }))
                    }
                  />
                  <span>×</span>
                </div>
              </label>
              <button
                className="text-button reset-placement"
                onClick={() =>
                  activeFrame && changeActiveFrame((frame) => ({ ...frame, offsetX: 0, offsetY: 0, scale: 1 }))
                }
                disabled={!activeFrame}
              >
                Reset
              </button>
              <label className="sheet-layout-control">
                Sheet layout
                <select value={sheetLayout} onChange={(event) => setSheetLayout(event.target.value as FrameLayout)}>
                  <option value="horizontal">Horizontal</option>
                  <option value="grid">Grid</option>
                </select>
              </label>
              <label className="sheet-padding-control">
                Padding
                <input
                  type="number"
                  min="0"
                  max="128"
                  value={sheetPadding}
                  onChange={(event) => setSheetPadding(Math.max(0, Math.min(128, Number(event.target.value) || 0)))}
                />
              </label>
            </div>
            <div className="frame-export-tools">
              <button
                className="text-button"
                disabled={!frames.length || exportBusy}
                onClick={() => void exportFrameZip()}
              >
                {exportBusy ? "Exporting…" : "Frames ZIP"}
              </button>
              <button
                className="text-button"
                disabled={!frames.length || exportBusy}
                onClick={() => void exportAnimation("gif")}
              >
                GIF
              </button>
              <button
                className="text-button"
                disabled={!frames.length || exportBusy}
                onClick={() => void exportAnimation("webp")}
              >
                Animated WebP
              </button>
              <button
                className="text-button"
                disabled={!frames.length || exportBusy}
                onClick={() => void exportAnimation("apng")}
              >
                APNG
              </button>
            </div>
            <div className="timeline-panel">
              <div className="timeline-heading">
                <div>
                  <span className="eyebrow">TIMELINE</span>
                  <span className="frame-count">{frames.length} frames</span>
                  <small className="inbetween-selection-hint">
                    {inBetweenSelection.length}/2 source frames selected
                  </small>
                </div>
                <div className="timeline-actions">
                  <button className="text-button" onClick={() => fileInputRef.current?.click()}>
                    ＋ Add frames
                  </button>
                  <button
                    className="button secondary inbetween-action"
                    disabled={inBetweenSelection.length !== 2 || generatingInBetween}
                    onClick={() => void generateBetweenSelected()}
                    title="Check exactly two timeline frames"
                  >
                    {generatingInBetween ? "Generating in-between…" : "✧ Generate in-between"}
                  </button>
                </div>
              </div>
              {frames.length ? (
                <div className="frame-strip" aria-label="Animation frame timeline">
                  {frames.map((frame, index) => (
                    <div
                      key={frame.id}
                      className={`frame-thumb ${index === activeIndex ? "selected" : ""} ${inBetweenSelection.includes(frame.id) ? "inbetween-selected" : ""} ${card.thumbnailFrameId === frame.id ? "thumbnail-selected" : ""} ${draggedFrameId === frame.id ? "dragging" : ""} ${dropTargetFrameId === frame.id ? "drop-target" : ""}`}
                      role="button"
                      tabIndex={0}
                      draggable
                      aria-label={`Frame ${index + 1}: ${frame.name}. Drag to reorder; Alt plus left or right arrow also reorders.`}
                      aria-grabbed={draggedFrameId === frame.id}
                      onClick={() => setActiveIndex(index)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", frame.id);
                        setDraggedFrameId(frame.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTargetFrameId(frame.id);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = event.dataTransfer.getData("text/plain") || draggedFrameId;
                        if (sourceId) reorderFrame(sourceId, frame.id);
                        setDraggedFrameId(null);
                        setDropTargetFrameId(null);
                      }}
                      onDragEnd={() => {
                        setDraggedFrameId(null);
                        setDropTargetFrameId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveIndex(index);
                        } else if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                          event.preventDefault();
                          event.stopPropagation();
                          const target = frames[index + (event.key === "ArrowLeft" ? -1 : 1)];
                          if (target) reorderFrame(frame.id, target.id);
                        }
                      }}
                    >
                      <label
                        className="inbetween-frame-select"
                        onClick={(event) => event.stopPropagation()}
                        title="Use this frame as an in-between reference"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select frame ${index + 1} as an in-between source`}
                          checked={inBetweenSelection.includes(frame.id)}
                          onChange={(event) => toggleInBetweenFrame(frame.id, event.target.checked)}
                        />
                        <span>INBETWEEN</span>
                      </label>
                      <span className="thumb-image checkerboard">
                        {imageUrls[activeFrameImageKey(frame)] ? (
                          <img src={imageUrls[activeFrameImageKey(frame)]} alt="" />
                        ) : (
                          <i>?</i>
                        )}
                      </span>
                      <span className="thumb-index">{String(index + 1).padStart(2, "0")}</span>
                      <button
                        className="remove-frame"
                        aria-label={`Remove frame ${index + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setFrames((current) => current.filter((item) => item.id !== frame.id));
                          setInBetweenSelection((current) => current.filter((id) => id !== frame.id));
                          setActiveIndex((current) => Math.max(0, Math.min(current, frames.length - 2)));
                          if (card.thumbnailFrameId === frame.id) onSaveCardSettings({ thumbnailFrameId: undefined });
                        }}
                      >
                        ×
                      </button>
                      <button
                        className={`set-thumbnail ${card.thumbnailFrameId === frame.id ? "thumbnail-active" : ""}`}
                        aria-label={
                          card.thumbnailFrameId === frame.id
                            ? `Clear card thumbnail on frame ${index + 1}`
                            : `Set frame ${index + 1} as card thumbnail`
                        }
                        title={card.thumbnailFrameId === frame.id ? "Remove card thumbnail" : "Set as card thumbnail"}
                        onClick={(event) => {
                          event.stopPropagation();
                          setCardThumbnail(card.thumbnailFrameId === frame.id ? null : frame.id);
                        }}
                      >
                        ★
                      </button>
                      <button
                        className="touch-up-frame"
                        aria-label={`Touch up frame ${index + 1}`}
                        title="Touch up this frame"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openTouchUp(frame);
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="timeline-empty">
                  Import animation frames to edit placement and generate new poses between frames.
                </div>
              )}
              {message && (
                <p className="editor-message" role="status">
                  {message}
                </p>
              )}
            </div>
          </section>
        </div>
        <aside className="frame-settings">
          <div className="panel-header">
            <span className="eyebrow">ANIMATION SETTINGS</span>
          </div>
          <div className="selected-pose-setting">
            <span>Character source</span>
            <div className="pose-setting-content">
              <div>
                <strong>Project anchor</strong>
              </div>
            </div>
            <small>The selected project anchor is the only image reference sent for generation.</small>
          </div>
          <label className="setting-field">
            Frame rate{" "}
            <div className="input-suffix">
              <input
                type="number"
                min="1"
                max="60"
                value={fps}
                onChange={(event) => setFps(Math.max(1, Number(event.target.value) || 1))}
              />
              <span>FPS</span>
            </div>
          </label>
          <label className="toggle-row">
            <span>
              <strong>Loop animation</strong>
              <small>Repeat playback continuously</small>
            </span>
            <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
          </label>
          <div className="setting-divider" />
          <div className="eyebrow">PREVIEW</div>
          <label className="setting-field pixelate-field">
            <span>Pixelate preview</span>
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={pixelate}
              onChange={(event) => setPixelate(Number(event.target.value))}
            />
            <span className="pixelate-value">{pixelate <= 0 ? "Off" : `×${pixelate}`}</span>
          </label>
          <div className="setting-divider" />
          <div className="eyebrow">SELECTED FRAME</div>
          <div className="selected-frame-info">
            <span>Frame</span>
            <strong>
              {frames.length
                ? `${String(activeIndex + 1).padStart(2, "0")} / ${String(frames.length).padStart(2, "0")}`
                : "—"}
            </strong>
          </div>
          <div className="selected-frame-info">
            <span>Duration</span>
            <label className="duration-input">
              <input
                type="number"
                min="1"
                value={activeFrame?.durationMs ?? Math.round(1000 / Math.max(fps, 1))}
                disabled={!activeFrame}
                onChange={(event) =>
                  activeFrame &&
                  changeActiveFrame((frame) => ({ ...frame, durationMs: Math.max(1, Number(event.target.value) || 1) }))
                }
              />
              <small>ms</small>
            </label>
          </div>
          <div className="frame-action-row">
            <button
              className="button secondary frame-export"
              onClick={() => void exportCurrentFrame()}
              disabled={!activeFrame}
            >
              ↓ Export selected PNG
            </button>
            <button
              className="button secondary frame-touch-up"
              disabled={!activeFrame}
              onClick={() => activeFrame && void openTouchUp(activeFrame)}
              title="Open the pixel editor for the selected frame"
            >
              ✎ Touch up selected frame
            </button>
            <button
              className="button secondary frame-ai-touch-up"
              disabled={!activeFrame}
              onClick={() => activeFrame && setAiTouchUpTarget(activeFrame)}
              title="Send the selected frame to the image model for an AI touch-up"
            >
              ✨ AI touch up
            </button>
            <button
              className={`button secondary frame-thumbnail-setting ${card.thumbnailFrameId && card.thumbnailFrameId === activeFrame?.id ? "thumbnail-active" : ""}`}
              disabled={!activeFrame}
              onClick={() =>
                setCardThumbnail(card.thumbnailFrameId === activeFrame?.id ? null : (activeFrame?.id ?? null))
              }
              title="Use the selected frame as this card's thumbnail in the project grid"
            >
              {card.thumbnailFrameId && card.thumbnailFrameId === activeFrame?.id
                ? "★ Card thumbnail · click to clear"
                : "☆ Set as card thumbnail"}
            </button>
            {activeFrame?.editImageKey ? (
              <button
                className="button secondary frame-revert-edit"
                onClick={() => onRevertFrameEdit(activeFrame)}
                title="Discard the touch-up and show the original generated frame"
              >
                ↺ Revert touch-up
              </button>
            ) : null}
          </div>
          <div className="storage-note">
            <span>●</span> Frame edits are saved locally.
          </div>
        </aside>
      </div>
    </section>
  );
}
