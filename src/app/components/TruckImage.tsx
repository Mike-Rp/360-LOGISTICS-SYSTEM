import { useState } from 'react';
import { Truck } from 'lucide-react';
import { truckImageFor } from '../data/truckTypes';

/* Truck picture for a classification (or an explicit src), with a neutral truck icon
   when the type has no picture (missing / "Tanker") or the file fails to load.
   `className` sizes the box; the picture scales inside it without stretching.
   `zoom` crops the empty border of the 1024px artwork — for small circles only. */
export default function TruckImage({ classification, src, alt, className = '', iconClassName = 'w-1/2 h-1/2 text-muted-foreground', zoom = false, anchorLeft = false }: {
  classification?: string | null;
  src?: string;
  alt?: string;
  className?: string;
  iconClassName?: string;
  zoom?: boolean;
  /* Fill the box and keep the picture's LEFT edge — for side views, whose truck sits on the left */
  anchorLeft?: boolean;
}) {
  const url = src ?? truckImageFor(classification);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return (
      <div className={`${className} flex items-center justify-center`}>
        <Truck className={iconClassName} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt ?? classification ?? 'Truck'}
      loading="lazy"
      onError={() => setFailedUrl(url)}
      className={`${className} max-w-full ${anchorLeft ? 'object-cover object-left' : 'object-contain'} ${zoom ? 'scale-[1.6]' : ''}`}
    />
  );
}
