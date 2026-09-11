'use client';

import { useState } from 'react';
import { QualityScore } from '@/lib/types';

interface LogoResultViewProps {
  imageUrl: string;
  qualityReview: QualityScore | null;
  brandName: string;
  iteration: number;
  isReviewing: boolean;
  isGenerating: boolean;
  onRegenerate: () => void;
  onReview: () => void;
  onIterate: () => void;
  canIterate: boolean;
  onDownload: (format: 'svg' | 'png') => void;
  onNewLogo: () => void;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 9 ? 'bg-green-500' : score >= 7 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-xs text-zinc-400">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(score / 10) * 100}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-medium text-zinc-300">{score}/10</span>
    </div>
  );
}

export default function LogoResultView({
  imageUrl,
  qualityReview,
  brandName,
  iteration,
  isReviewing,
  isGenerating,
  onRegenerate,
  onReview,
  onIterate,
  canIterate,
  onDownload,
  onNewLogo,
}: LogoResultViewProps) {
  const [previewBackground, setPreviewBackground] = useState<'light' | 'dark' | 'transparent'>('light');
  const previewClass = previewBackground === 'dark'
    ? 'bg-zinc-950'
    : previewBackground === 'transparent'
      ? 'bg-[linear-gradient(45deg,#ddd_25%,transparent_25%),linear-gradient(-45deg,#ddd_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ddd_75%),linear-gradient(-45deg,transparent_75%,#ddd_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]'
      : 'bg-white';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Logo Display */}
      <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">{brandName}</h2>
            {iteration > 0 && (
              <span className="rounded-full bg-amber-600/20 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                Iteration {iteration}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onNewLogo}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              Edit brief
            </button>
            {imageUrl.startsWith('data:image/svg+xml') ? (
              <>
                <button onClick={() => onDownload('svg')} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">Download SVG</button>
                <button onClick={() => onDownload('png')} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500">Download PNG</button>
              </>
            ) : (
              <><button onClick={() => onDownload('svg')} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">Create SVG</button><button onClick={() => onDownload('png')} className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-500">Download PNG</button></>
            )}
          </div>
        </div>
        <div className={`p-8 ${previewClass}`}>
          {isGenerating ? (
            <div className="flex flex-col items-center gap-4 py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <p className="text-sm text-zinc-400">Generating your logo...</p>
              <p className="text-xs text-zinc-600">This takes 15-30 seconds</p>
            </div>
          ) : (
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={`${brandName} logo`}
                className="max-h-96 rounded-xl border border-white/10"
              />
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      {!isGenerating && (
        <div className="flex flex-wrap justify-center gap-3">
          <div className="flex rounded-lg border border-white/10 p-1">
            {(['light', 'dark', 'transparent'] as const).map((background) => (
              <button key={background} onClick={() => setPreviewBackground(background)} className={`rounded-md px-3 py-1.5 text-xs capitalize ${previewBackground === background ? 'bg-white text-black' : 'text-zinc-400'}`}>{background}</button>
            ))}
          </div>
          <button
            onClick={onRegenerate}
            className="rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            ↻ Regenerate · 1 credit
          </button>
          {!qualityReview && (
            <button
              onClick={onReview}
              disabled={isReviewing}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              {isReviewing ? 'Reviewing...' : '⭐ Review Quality'}
            </button>
          )}
        </div>
      )}

      {/* Quality Review */}
      {qualityReview && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`text-3xl font-bold ${qualityReview.overall >= 9 ? 'text-green-400' : qualityReview.overall >= 7 ? 'text-amber-400' : 'text-red-400'}`}>
                {qualityReview.overall}
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  {qualityReview.overall >= 9 ? '✓ Premium Quality' : 'Needs Improvement'}
                </p>
                <p className="text-xs text-zinc-500">Target: 9+ / 10</p>
              </div>
            </div>
            {!qualityReview.approved && (
              <button
                onClick={onIterate}
                disabled={!canIterate}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              >
                {canIterate ? '↻ Iterate & Improve · 1 credit' : 'Revision limit reached'}
              </button>
            )}
          </div>

          <div className="space-y-2 mb-4">
            <ScoreBar label="Simplicity" score={qualityReview.scores.simplicity} />
            <ScoreBar label="Memorability" score={qualityReview.scores.memorability} />
            <ScoreBar label="Scalability" score={qualityReview.scores.scalability} />
            <ScoreBar label="Authority" score={qualityReview.scores.authority} />
            <ScoreBar label="Cleverness" score={qualityReview.scores.cleverness} />
            <ScoreBar label="Timelessness" score={qualityReview.scores.timelessness} />
            <ScoreBar label="Billion $ Feel" score={qualityReview.scores.billionDollarFeel} />
          </div>

          <p className="text-sm text-zinc-400 mb-3">{qualityReview.feedback}</p>

          {qualityReview.suggestions.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-300 mb-1">Suggestions</h4>
              <ul className="space-y-1">
                {qualityReview.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-zinc-500">
                    <span className="text-blue-500">→</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
