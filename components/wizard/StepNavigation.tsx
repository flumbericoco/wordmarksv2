'use client';

interface StepNavigationProps {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  canGoBack: boolean;
}

export default function StepNavigation({ onBack, onNext, nextLabel = 'Continue', nextDisabled, canGoBack }: StepNavigationProps) {
  return (
    <div className="flex items-center justify-between pt-5">
      {canGoBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white/45 transition-colors hover:bg-white/5 hover:text-white"
        >
          ← Back
        </button>
      ) : (
        <div />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="group inline-flex min-h-12 items-center gap-5 rounded-full bg-[#c6ff4a] py-2 pl-6 pr-2 text-sm font-black text-black transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_30px_rgba(198,255,74,0.16)] disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-white/10 disabled:text-white/25 disabled:shadow-none"
      >
        {nextLabel}
        <span className="grid h-8 w-8 place-items-center rounded-full bg-black text-white transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
      </button>
    </div>
  );
}
