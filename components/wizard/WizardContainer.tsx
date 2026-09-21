'use client';

import { useState } from 'react';
import { WizardData, WizardStep, AiRecommendations } from '@/lib/types';
import { researchBrand } from '@/lib/api';
import StepInput from './StepInput';
import StepResearch from './StepResearch';

interface WizardContainerProps {
  onComplete: (data: WizardData, research: string) => void;
}

export default function WizardContainer({ onComplete }: WizardContainerProps) {
  const [step, setStep] = useState<WizardStep>('input');
  const [data, setData] = useState<WizardData>({
    brandName: '',
    description: '',
    referenceImages: [],
  });
  const [recommendations, setRecommendations] = useState<AiRecommendations | null>(null);
  const [selectedStyle, setSelectedStyle] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedLayout, setSelectedLayout] = useState('');
  const [isResearching, setIsResearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputComplete = async (name: string, desc: string) => {
    localStorage.setItem('wordmarks:draft', JSON.stringify({ name, description: desc, savedAt: Date.now() }));
    const session = await fetch('/api/v1/account/me', { credentials: 'same-origin' });
    if (!session.ok) {
      window.location.assign('/account?next=%2F%23create');
      return;
    }
    setData((prev) => ({ ...prev, brandName: name, description: desc }));
    setStep('research');
    setIsResearching(true);
    setError(null);

    try {
      const recs = await researchBrand(name, desc);
      setRecommendations(recs);

      // Auto-select top recommendations
      if (recs.styleRecommendations.length > 0) {
        setSelectedStyle(recs.styleRecommendations[0].id);
      }
      if (recs.colorRecommendations.length > 0) {
        setSelectedColor(recs.colorRecommendations[0].id);
      }
      if (recs.layoutRecommendations.length > 0) {
        setSelectedLayout(recs.layoutRecommendations[0].id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Research failed');
      // Fallback: skip research, go straight to generate
      setRecommendations(null);
    } finally {
      setIsResearching(false);
    }
  };

  const handleGenerate = () => {
    const finalData: WizardData = {
      ...data,
      style: selectedStyle,
      colorPreference: selectedColor,
      layout: selectedLayout,
    };

    const researchText = recommendations
      ? `Industry: ${recommendations.industry}. ${recommendations.industryReasoning}. Brand personality: ${recommendations.brandPersonality.join(', ')}. Competitor context: ${recommendations.competitorContext}`
      : undefined;

    onComplete(finalData, researchText || '');
  };

  // Loading state for research
  if (step === 'research' && isResearching) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center gap-6 py-24">
          <div className="relative">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <span className="absolute inset-0 flex items-center justify-center text-2xl">🧠</span>
          </div>
          <div className="text-center">
            <h3 className="text-lg font-bold text-white">Preparing {data.brandName}...</h3>
            <p className="mt-1 text-sm text-zinc-400">Preparing the brief; Studio instructions and knowledge apply to final generation</p>
          </div>
          <div className="flex gap-2 text-xs text-zinc-600">
            <span className="animate-pulse">●</span>
            <span>Brand context</span>
            <span>·</span>
            <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>●</span>
            <span>Style options</span>
            <span>·</span>
            <span className="animate-pulse" style={{ animationDelay: '0.6s' }}>●</span>
            <span>Generation context</span>
          </div>
        </div>
      </div>
    );
  }

  // Error fallback
  if (error && !recommendations) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 mb-6">
          <p className="text-sm text-red-400">{error}</p>
          <p className="mt-1 text-xs text-zinc-500">You can still generate a logo — AI recommendations were skipped.</p>
        </div>
        <StepInput
          brandName={data.brandName}
          description={data.description}
          onNext={(name, desc) => {
            setData((prev) => ({ ...prev, brandName: name, description: desc }));
            setError(null);
            handleGenerate();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Progress */}
      <div className="mb-8 flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-2">
          {['Input', 'Research', 'Generate'].map((label, idx) => {
            const isActive = (step === 'input' && idx === 0) || (step === 'research' && idx === 1);
            const isDone = (step === 'research' && idx === 0) || step === 'generating' || step === 'result';
            return (
              <div key={label} className={`flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5 transition-all ${
                isActive ? 'bg-white/[0.09] text-white' : isDone ? 'text-[#c6ff4a]' : 'text-white/25'
              }`}>
                <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-black ${
                  isDone ? 'bg-[#c6ff4a] text-black' : isActive ? 'bg-[#ff7655] text-white' : 'border border-white/15'
                }`}>{isDone ? '✓' : idx + 1}</span>
                <span className="hidden text-[10px] font-bold uppercase tracking-[0.14em] sm:inline">{label}</span>
              </div>
            );
          })}
      </div>

      {/* Steps */}
      {step === 'input' && (
        <StepInput
          brandName={data.brandName}
          description={data.description}
          onNext={handleInputComplete}
        />
      )}

      {step === 'research' && recommendations && (
        <StepResearch
          data={recommendations}
          brandName={data.brandName}
          selectedStyle={selectedStyle}
          selectedColor={selectedColor}
          selectedLayout={selectedLayout}
          onSelectStyle={setSelectedStyle}
          onSelectColor={setSelectedColor}
          onSelectLayout={setSelectedLayout}
          onGenerate={handleGenerate}
          onBack={() => setStep('input')}
        />
      )}
    </div>
  );
}
