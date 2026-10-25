import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

const PHRASES = ['Good day', 'Welcome back', 'Good to see you'] as const;
const SEQUENCE = [0, 1, 2, 1] as const;
const ROTATION_MS = 5000;
const FINAL_STEP = SEQUENCE.length - 1;

export default function WelcomeGreeting({ name }: { name?: string }) {
  const [step, setStep] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion || step === FINAL_STEP) return;
    const timer = window.setTimeout(() => setStep((current) => current + 1), ROTATION_MS);
    return () => window.clearTimeout(timer);
  }, [step, reducedMotion]);

  const displayName = name?.trim();
  const visibleStep = reducedMotion ? FINAL_STEP : step;
  return (
    <h1
      aria-label={displayName ? `Welcome back, ${displayName}` : 'Welcome back'}
      className={`flex min-w-0 flex-wrap items-center gap-x-2 text-2xl font-semibold leading-tight text-foreground sm:text-3xl ${displayName ? 'min-h-[2.5em] lg:min-h-0' : ''}`}
    >
      <motion.span
        aria-hidden="true"
        layout="size"
        transition={{ layout: { duration: reducedMotion ? 0 : 0.4, ease: 'easeInOut' } }}
        className="relative inline-flex shrink-0 items-baseline whitespace-nowrap"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={visibleStep}
            initial={reducedMotion ? false : { y: '35%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reducedMotion ? undefined : { y: '-35%', opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.4, ease: 'easeInOut' }}
            className="inline-block whitespace-nowrap"
          >
            {PHRASES[SEQUENCE[visibleStep]]}
          </motion.span>
        </AnimatePresence>
        {displayName && ','}
      </motion.span>
      {displayName && (
        <motion.span
          aria-hidden="true"
          layout="position"
          transition={{ layout: { duration: reducedMotion ? 0 : 0.4, ease: 'easeInOut' } }}
          className="min-w-0 break-words"
        >
          {displayName}
        </motion.span>
      )}
    </h1>
  );
}
