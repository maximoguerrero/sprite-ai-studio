import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  floodFill,
  getPixel,
  replaceColor,
  stampCircle,
  strokeLine,
  type BrushAction,
  type RGBA,
} from "../lib/frameTouchup";
import { removeGreenScreen } from "../lib/imageUtils";
import { Dialog } from "./Dialog";

type TouchUpTool = "brush" | "eraser" | "pick" | "fill" | "replace";

const TOOL_LABELS: Record<TouchUpTool, string> = {
  brush: "Brush",
  eraser: "Erase",
  pick: "Pick",
  fill: "Fill",
  replace: "Swap",
};

const MAX_HISTORY = 40;

export function FrameTouchUpEditor({
  title,
  source,
  onClose,
  onSave,
}: {
  title: string;
  /** Original (un-edited) image for this frame. */
  source: Blob;
  onClose: () => void;
  /** Receives the edited PNG, or null when the canvas could not be read. */
  onSave: (png: Blob | null) => Promise<void>;
}) {
  const [tool, setTool] = useState<TouchUpTool>("brush");
  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(1);
  const [tolerance, setTolerance] = useState(30);
  const [zoom, setZoom] = useState(8);
  const [onion, setOnion] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [historyLen, setHistoryLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const bufferRef = useRef<ImageData | null>(null);
  const originalRef = useRef<ImageData | null>(null);
  const historyRef = useRef<Uint8ClampedArray[]>([]);
  const redoRef = useRef<Uint8ClampedArray[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const savedRef = useRef(false);

  const paint = () => {
    const canvas = canvasRef.current;
    const buffer = bufferRef.current;
    if (!canvas || !buffer) return;
    if (canvas.width !== buffer.width || canvas.height !== buffer.height) {
      canvas.width = buffer.width;
      canvas.height = buffer.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (onion && originalRef.current) ctx.putImageData(originalRef.current, 0, 0);
    ctx.putImageData(buffer, 0, 0);
  };

  const syncHistory = () => {
    setHistoryLen(historyRef.current.length);
    setRedoLen(redoRef.current.length);
  };

  const pushHistory = () => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const history = historyRef.current;
    history.push(new Uint8ClampedArray(buffer.data));
    if (history.length > MAX_HISTORY) history.shift();
    redoRef.current = [];
    syncHistory();
  };

  const restore = (snapshot: Uint8ClampedArray) => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    buffer.data.set(snapshot);
    paint();
    setDirty(true);
  };

  const undo = () => {
    const history = historyRef.current;
    const buffer = bufferRef.current;
    if (!history.length || !buffer) return;
    redoRef.current.push(new Uint8ClampedArray(buffer.data));
    restore(history.pop()!);
    syncHistory();
  };

  const redo = () => {
    const stack = redoRef.current;
    const buffer = bufferRef.current;
    if (!stack.length || !buffer) return;
    historyRef.current.push(new Uint8ClampedArray(buffer.data));
    restore(stack.pop()!);
    syncHistory();
  };

  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const off = document.createElement("canvas");
      off.width = width;
      off.height = height;
      const ctx = off.getContext("2d");
      if (!ctx || cancelled) return;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, width, height);
      bufferRef.current = data;
      originalRef.current = new ImageData(new Uint8ClampedArray(data.data), width, height);
      historyRef.current = [];
      redoRef.current = [];
      syncHistory();
      setSize({ width, height });
      setZoom(width <= 32 ? 10 : width <= 64 ? 6 : width <= 128 ? 4 : 2);
      setStatus(`${width}×${height}`);
      paint();
    };
    image.onerror = () => {
      if (!cancelled) setStatus("Could not load this frame.");
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onion]);

  const toCanvasPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    return { x, y };
  };

  const currentAction = (): BrushAction =>
    tool === "eraser" ? { kind: "erase" } : { kind: "paint", color: hexToRgba(color) };

  // Brush preview: the stamp radius is brushSize - 1, so the painted footprint is
  // (2 * brushSize - 1) source pixels wide; scale it by zoom for the on-screen ring.
  const showBrushCursor = tool === "brush" || tool === "eraser";
  const cursorDiameter = Math.max(1, 2 * brushSize - 1) * zoom;
  const brushRgba = hexToRgba(color);
  const cursorFill = !showBrushCursor
    ? "transparent"
    : tool === "eraser"
      ? "rgba(255,255,255,0.14)"
      : `rgba(${brushRgba.r}, ${brushRgba.g}, ${brushRgba.b}, 0.22)`;

  const moveBrushCursor = (event: PointerEvent<HTMLCanvasElement>) => {
    const cursor = cursorRef.current;
    const canvas = canvasRef.current;
    if (!cursor || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    cursor.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px) translate(-50%, -50%)`;
  };

  const showBrushCursorAt = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!showBrushCursor) return;
    moveBrushCursor(event);
    if (cursorRef.current) cursorRef.current.style.opacity = "1";
  };

  const hideBrushCursor = () => {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
  };

  useEffect(() => {
    // Switching to a non-painting tool (or resizing the brush while hidden) resets the ring.
    hideBrushCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const buffer = bufferRef.current;
    const point = toCanvasPoint(event);
    if (!buffer || !point) return;
    showBrushCursorAt(event);
    if (tool === "pick") {
      const hex = rgbaToHex(getPixel(buffer, point.x, point.y));
      setColor(hex);
      setStatus(`Picked ${hex}`);
      return;
    }
    pushHistory();
    if (tool === "brush" || tool === "eraser") {
      drawingRef.current = true;
      lastPointRef.current = point;
      stampCircle(buffer, point.x, point.y, brushSize - 1, currentAction());
    } else if (tool === "fill") {
      const changed = floodFill(buffer, point.x, point.y, hexToRgba(color), { tolerance });
      setStatus(changed ? `Filled ${changed} pixels` : "Nothing to fill");
    } else if (tool === "replace") {
      const target = getPixel(buffer, point.x, point.y);
      const changed = replaceColor(buffer, target, hexToRgba(color), tolerance);
      setStatus(changed ? `Replaced ${changed} pixels` : "No matching pixels");
    }
    paint();
    setDirty(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    showBrushCursorAt(event);
    if (!drawingRef.current) return;
    const buffer = bufferRef.current;
    const point = toCanvasPoint(event);
    if (!buffer || !point) return;
    const last = lastPointRef.current;
    if (last) strokeLine(buffer, last.x, last.y, point.x, point.y, brushSize - 1, currentAction());
    else stampCircle(buffer, point.x, point.y, brushSize - 1, currentAction());
    lastPointRef.current = point;
    paint();
    setDirty(true);
  };

  const endStroke = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const handlePointerLeave = () => {
    endStroke();
    hideBrushCursor();
  };

  const clearToTransparent = () => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    pushHistory();
    buffer.data.fill(0);
    paint();
    setDirty(true);
    setStatus("Frame cleared");
  };

  const runGreenScreen = async () => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    setBusy(true);
    try {
      const off = document.createElement("canvas");
      off.width = buffer.width;
      off.height = buffer.height;
      const ctx = off.getContext("2d")!;
      ctx.putImageData(buffer, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, "image/png"));
      if (!blob) return;
      const cleaned = await removeGreenScreen(blob);
      const url = URL.createObjectURL(cleaned);
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("decode failed"));
          image.src = url;
        });
        ctx.clearRect(0, 0, off.width, off.height);
        ctx.drawImage(image, 0, 0);
        const fresh = ctx.getImageData(0, 0, off.width, off.height);
        pushHistory();
        buffer.data.set(fresh.data);
        paint();
        setDirty(true);
        setStatus("Green screen removed");
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setStatus("Green-screen cleanup failed");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (savedRef.current || !dirty) {
      onClose();
      return;
    }
    if (window.confirm("Discard your touch-up changes?")) onClose();
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!bufferRef.current || !canvas) {
      await onSave(null);
      return;
    }
    setBusy(true);
    try {
      paint();
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      savedRef.current = true;
      await onSave(png);
    } finally {
      setBusy(false);
    }
  };

  const swatches = useMemo(
    () => ["#000000", "#ffffff", "#e11d48", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#78716c"],
    []
  );

  return (
    <Dialog title={`Touch up ${title}`} onClose={handleClose}>
      <div className="touchup-dialog">
        <div className="touchup-layout">
          <div className="touchup-toolbar">
            <div className="touchup-tools" role="group" aria-label="Touch-up tools">
              {(Object.keys(TOOL_LABELS) as TouchUpTool[]).map((name) => (
                <button
                  key={name}
                  className={tool === name ? "tool-chip active" : "tool-chip"}
                  onClick={() => setTool(name)}
                  title={TOOL_LABELS[name]}
                >
                  {TOOL_LABELS[name]}
                </button>
              ))}
            </div>
            <label className="touchup-field">
              <span>Color</span>
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
            <div className="touchup-swatches" role="group" aria-label="Color swatches">
              {swatches.map((hex) => (
                <button
                  key={hex}
                  className="touchup-swatch"
                  style={{ background: hex }}
                  onClick={() => setColor(hex)}
                  title={hex}
                  aria-label={`Use ${hex}`}
                />
              ))}
            </div>
            <label className="touchup-field">
              <span>Brush {brushSize}px</span>
              <input
                type="range"
                min={1}
                max={16}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
            </label>
            <label className="touchup-field">
              <span>Tolerance {tolerance}</span>
              <input
                type="range"
                min={0}
                max={128}
                value={tolerance}
                onChange={(event) => setTolerance(Number(event.target.value))}
              />
            </label>
            <label className="touchup-field">
              <span>Zoom {zoom}×</span>
              <input
                type="range"
                min={1}
                max={24}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <label className="touchup-check">
              <input type="checkbox" checked={onion} onChange={(event) => setOnion(event.target.checked)} />
              <span>Onion-skin original</span>
            </label>
            <button
              className="button secondary"
              onClick={runGreenScreen}
              disabled={busy}
              title="Remove green-screen background"
            >
              Remove green screen
            </button>
            <button
              className="button secondary"
              onClick={clearToTransparent}
              disabled={busy}
              title="Clear the whole frame"
            >
              Clear frame
            </button>
          </div>
          <div className="touchup-stage checkerboard">
            <div className="touchup-canvas-wrap">
              <canvas
                ref={canvasRef}
                className={showBrushCursor ? "touchup-canvas cursor-hidden" : "touchup-canvas"}
                style={{
                  width: size.width ? size.width * zoom : undefined,
                  height: size.height ? size.height * zoom : undefined,
                  touchAction: "none",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerEnter={showBrushCursorAt}
                onPointerUp={endStroke}
                onPointerLeave={handlePointerLeave}
              />
              <div
                ref={cursorRef}
                className="touchup-brush-cursor"
                aria-hidden="true"
                style={{ width: cursorDiameter, height: cursorDiameter, background: cursorFill }}
              />
            </div>
          </div>
        </div>
        <div className="dialog-actions touchup-actions">
          <button className="button secondary" onClick={undo} disabled={!historyLen || busy} title="Undo last change">
            ↶ Undo
          </button>
          <button className="button secondary" onClick={redo} disabled={!redoLen || busy} title="Redo">
            ↷ Redo
          </button>
          <span className="touchup-status">{status}</span>
          <button className="button secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" onClick={handleSave} disabled={busy || !size.width}>
            {busy ? "Working…" : "Save edited copy"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function hexToRgba(hex: string): RGBA {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const num = Number.parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 255 };
}

function rgbaToHex(pixel: RGBA) {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(pixel.r)}${hex(pixel.g)}${hex(pixel.b)}`;
}
