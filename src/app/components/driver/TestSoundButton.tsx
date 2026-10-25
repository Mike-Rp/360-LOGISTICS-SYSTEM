import { CheckCircle2, Volume2, VolumeX } from 'lucide-react';

export type TestSoundState = 'idle' | 'playing' | 'started' | 'blocked' | 'unsupported' | 'failed';

export default function TestSoundButton({ state, onTest, labels }: {
  state: TestSoundState;
  onTest: () => void;
  labels: { idle: string; playing: string; started: string; retry: string };
}) {
  const unavailable = state === 'blocked' || state === 'unsupported' || state === 'failed';
  return (
    <button type="button" onClick={onTest} disabled={state === 'playing'} aria-busy={state === 'playing'}
      className="mt-3 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold leading-5 text-gray-700 transition-transform duration-150 active:scale-[0.97] disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-green-700 motion-reduce:transform-none motion-reduce:transition-none">
      {state === 'started' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
        : unavailable ? <VolumeX className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          : <Volume2 className={`h-4 w-4 shrink-0 ${state === 'playing' ? 'animate-pulse motion-reduce:animate-none' : ''}`} aria-hidden="true" />}
      <span aria-live="polite">{state === 'idle' ? labels.idle : state === 'playing' ? labels.playing : state === 'started' ? labels.started : labels.retry}</span>
    </button>
  );
}
