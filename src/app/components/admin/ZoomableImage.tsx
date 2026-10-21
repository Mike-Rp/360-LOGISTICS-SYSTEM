import { useEffect, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

type Size = { width: number; height: number };
type Point = { x: number; y: number };

export default function ZoomableImage({ url, alt, onError, labels }: {
  url: string;
  alt: string;
  onError: () => void;
  labels?: Partial<{ zoomIn: string; zoomOut: string; fit: string }>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The image never enlarges past its natural dimensions at the fitted state.
  const fit = natural.width && natural.height && viewport.width && viewport.height
    ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height) : 0;
  const fittedWidth = natural.width * fit;
  const fittedHeight = natural.height * fit;
  const clampPan = (point: Point, scale: number): Point => ({
    x: Math.max(-Math.max(0, (fittedWidth * scale - viewport.width) / 2),
      Math.min(Math.max(0, (fittedWidth * scale - viewport.width) / 2), point.x)),
    y: Math.max(-Math.max(0, (fittedHeight * scale - viewport.height) / 2),
      Math.min(Math.max(0, (fittedHeight * scale - viewport.height) / 2), point.y)),
  });

  useEffect(() => { setPan(current => clampPan(current, zoom)); }, [viewport.width, viewport.height, natural.width, natural.height]);

  const changeZoom = (next: number) => {
    const bounded = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    setZoom(bounded);
    setPan(current => bounded === MIN_ZOOM ? { x: 0, y: 0 } : clampPan(current, bounded));
  };

  return <div className="relative h-full w-full min-h-0">
    <div ref={viewportRef} className={`flex h-full w-full items-center justify-center overflow-hidden ${zoom > MIN_ZOOM ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ touchAction: zoom > MIN_ZOOM ? 'none' : 'auto' }}
      onPointerDown={(event) => {
        if (zoom <= MIN_ZOOM) return;
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y };
        dragRef.current = { pointerId: drag.pointerId, x: event.clientX, y: event.clientY };
        setPan(current => clampPan({ x: current.x + delta.x, y: current.y + delta.y }, zoom));
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { dragRef.current = null; }}>
      <img src={url} alt={alt} draggable={false} onError={onError}
        onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        className="max-h-full max-w-full select-none object-contain"
        style={fit ? { width: fittedWidth, height: fittedHeight, maxWidth: 'none', maxHeight: 'none', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } : undefined} />
    </div>
    <div role="group" aria-label="Image zoom" className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-border bg-white/95 p-1 shadow-sm sm:right-3 sm:top-3">
      <button type="button" aria-label={labels?.zoomOut ?? 'Zoom out'} title={labels?.zoomOut ?? 'Zoom out'} disabled={zoom <= MIN_ZOOM}
        onClick={() => changeZoom(zoom - ZOOM_STEP)} className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary"><ZoomOut className="h-4 w-4" /></button>
      <span className="w-11 text-center text-xs tabular-nums text-foreground" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label={labels?.zoomIn ?? 'Zoom in'} title={labels?.zoomIn ?? 'Zoom in'} disabled={zoom >= MAX_ZOOM}
        onClick={() => changeZoom(zoom + ZOOM_STEP)} className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary"><ZoomIn className="h-4 w-4" /></button>
      <button type="button" aria-label={labels?.fit ?? 'Fit to view'} title={labels?.fit ?? 'Fit to view'} disabled={zoom === MIN_ZOOM && pan.x === 0 && pan.y === 0}
        onClick={() => changeZoom(MIN_ZOOM)} className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary"><Maximize2 className="h-4 w-4" /></button>
    </div>
  </div>;
}
