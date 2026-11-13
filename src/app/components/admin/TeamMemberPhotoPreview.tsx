import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { TeamMember } from '../../data/assignmentTypes';
import { useModalFocus } from './useModalFocus';
import { useModalBodyLock } from './useModalBodyLock';

export function memberInitials(name: string): string {
  return name.split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2);
}

export default function TeamMemberPhotoPreview({ member, photoUrl, onClose }: {
  member: TeamMember;
  photoUrl?: string;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useModalFocus(true, modalRef);
  useModalBodyLock(true);

  return <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] [padding-top:max(1rem,env(safe-area-inset-top))]">
    <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
    <div ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="member-photo-title"
      className="relative flex max-h-[90dvh] w-full max-w-sm min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="member-photo-title" className="min-w-0 text-base font-semibold text-foreground">Profile Photo</h2>
        <button type="button" onClick={onClose} aria-label="Close profile photo" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto px-4 py-6 text-center">
        <div className="mx-auto flex h-52 w-52 max-w-full items-center justify-center overflow-hidden rounded-2xl bg-slate-100 sm:h-60 sm:w-60">
          {photoUrl && !imageFailed
            ? <img src={photoUrl} alt={`${member.name}'s profile photo`} onError={() => setImageFailed(true)} className="h-full w-full object-contain" />
            : <span aria-label={`${member.name}'s initials`} className="flex h-full w-full items-center justify-center bg-slate-800 text-5xl font-semibold text-white">{memberInitials(member.name)}</span>}
        </div>
        <p className="mt-5 break-words text-lg font-semibold text-foreground">{member.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{member.role === 'csr' ? 'CSR' : 'Viewer'}</p>
      </div>
    </div>
  </div>;
}
