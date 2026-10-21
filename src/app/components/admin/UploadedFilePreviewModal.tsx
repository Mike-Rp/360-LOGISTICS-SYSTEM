import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Download, X } from 'lucide-react';
import { splitDisplayDateTime } from '../../lib/displayDateTime';

/** Viewer for the signed Storage URLs saved with photos and documents. */
export default function UploadedFilePreviewModal({ url, title, kind, timestamp, assignmentId, onClose, labels }: {
  url: string;
  title: string;
  kind: 'image' | 'document';
  timestamp?: string;
  assignmentId?: string;
  onClose: () => void;
  labels?: Partial<{
    close: string; dateUnavailable: string; download: string; downloading: string;
    downloadError: string; previewUnavailable: string;
  }>;
}) {
  const storedPath = url.startsWith('data:') ? '' : new URL(url, window.location.href).pathname;
  const [imageFailed, setImageFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const isPdf = url.startsWith('data:application/pdf') || /\.pdf$/i.test(storedPath);
  const isImage = kind === 'image' || /^data:image\//i.test(url) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(storedPath);
  const stamp = splitDisplayDateTime(timestamp);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const storedName = url.startsWith('data:') ? ''
        : decodeURIComponent(storedPath.split('/').pop() ?? '').replace(/[\\/:*?"<>|]/g, '-');
      const extension = blob.type === 'application/pdf' || isPdf ? 'pdf' : 'jpg';
      const fallbackName = `${[assignmentId, title].filter(Boolean).join('-').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evidence'}.${extension}`;
      const fileName = /\.[a-z0-9]{2,5}$/i.test(storedName) ? storedName : fallbackName;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      setDownloadError(labels?.downloadError ?? `Unable to download ${kind}. Please try again.`);
    } finally {
      setDownloading(false);
    }
  };

  return <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-slate-950/30" />
      <DialogPrimitive.Content aria-describedby={undefined}
        className="fixed left-1/2 top-1/2 z-[71] flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1200px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl focus:outline-none sm:h-[min(88dvh,900px)] sm:w-[88vw] sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="break-words text-base font-semibold text-foreground sm:text-lg">{title}</DialogPrimitive.Title>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {stamp ? <><span className="whitespace-nowrap">{stamp.date}</span>{stamp.time && <> · <span className="whitespace-nowrap">{stamp.time}</span></>}</> : labels?.dateUnavailable ?? 'Date unavailable'}
            </p>
          </div>
          <DialogPrimitive.Close aria-label={labels?.close ?? 'Close file preview'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-50 p-3 sm:p-5">
          {isPdf ? <iframe src={url} className="h-full min-h-0 w-full rounded-lg border border-border bg-white" title={title} />
            : isImage && !imageFailed ? <img src={url} alt={kind === 'image' ? `${title} photo` : title}
                onError={() => setImageFailed(true)} className="max-h-full max-w-full object-contain" />
              : <p className="text-sm text-muted-foreground">{labels?.previewUnavailable ?? 'Preview unavailable'}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-5">
          {downloadError && <p role="alert" className="mr-auto text-sm text-red-700">{downloadError}</p>}
          <button type="button" onClick={download} disabled={downloading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-medium text-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60">
            <Download className="h-4 w-4" aria-hidden="true" />{downloading ? labels?.downloading ?? 'Downloading…' : labels?.download ?? (kind === 'image' ? 'Download Image' : 'Download Document')}
          </button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
