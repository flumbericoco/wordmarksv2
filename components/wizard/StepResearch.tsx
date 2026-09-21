'use client';

import { AiRecommendations } from '@/lib/types';

const STYLE_EXAMPLES: Record<string, { preview: string; font: string; brands: string }> = {
  geometric: { preview: 'Stripe · Linear', font: 'tracking-tighter', brands: 'Stripe, Google, Airbnb' },
  humanist: { preview: 'Ubuntu · Zendesk', font: 'font-normal', brands: 'Ubuntu, Zendesk, Whole Foods' },
  'neo-grotesque': { preview: 'Helvetica · Inter', font: 'font-medium', brands: 'Apple, BMW, Netflix' },
  didone: { preview: 'Vogue · Harper\'s', font: 'font-serif font-bold italic', brands: 'Vogue, Tiffany, Rolex' },
  'slab-serif': { preview: 'Rockwell · Zilla', font: 'font-bold', brands: 'IBM, Sony,本田' },
  display: { preview: 'SPOTIFY · LEGO', font: 'font-black uppercase tracking-widest', brands: 'Spotify, LEGO, FedEx' },
  monospace: { preview: 'GitHub · Code', font: 'font-mono', brands: 'GitHub, JetBrains, Linear' },
  blackletter: { preview: 'The Times · BMW', font: 'font-serif font-black', brands: 'The New York Times, BMW' },
  'script-influenced': { preview: 'Coca-Cola · Instagram', font: 'font-light italic', brands: 'Coca-Cola, Instagram' },
  stencil: { preview: 'ARMY · INDUSTRIAL', font: 'font-bold uppercase tracking-widest', brands: 'US Army, Supreme' },
  rounded: { preview: 'Notion · Figma', font: 'font-medium rounded', brands: 'Notion, Figma, Slack' },
  condensed: { preview: 'TIME · Bloomberg', font: 'font-semibold uppercase tracking-tight', brands: 'TIME, Bloomberg, Wired' },
};

interface StepResearchProps {
  data: AiRecommendations;
  brandName: string;
  selectedStyle: string;
  selectedColor: string;
  selectedLayout: string;
  onSelectStyle: (id: string) => void;
  onSelectColor: (id: string) => void;
  onSelectLayout: (id: string) => void;
  onGenerate: () => void;
  onBack: () => void;
}

export default function StepResearch({
  data,
  brandName,
  selectedStyle,
  selectedColor,
  selectedLayout,
  onSelectStyle,
  onSelectColor,
  onSelectLayout,
  onGenerate,
  onBack,
}: StepResearchProps) {
  const topStyle = data.styleRecommendations[0];
  const topColor = data.colorRecommendations[0];
  const topLayout = data.layoutRecommendations[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">AI Recommendations for {brandName}</h2>
        <p className="mt-1 text-sm text-zinc-400">Based on research — click to change, or accept defaults</p>
      </div>

      {/* Industry Insight */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🔍</span>
          <h3 className="text-sm font-semibold text-blue-400">Industry: {data.industry}</h3>
        </div>
        <p className="text-xs text-zinc-400">{data.industryReasoning}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.brandPersonality.map((trait, i) => (
            <span key={i} className="rounded-full bg-blue-600/20 px-2.5 py-0.5 text-[10px] font-medium text-blue-400">
              {trait}
            </span>
          ))}
        </div>
      </div>

      {/* Style Recommendations */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Typographic Style</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.styleRecommendations.map((style) => {
            const example = STYLE_EXAMPLES[style.id] || { preview: 'Aa Bb Cc', font: 'font-sans', brands: '' };
            return (
              <button
                key={style.id}
                onClick={() => onSelectStyle(style.id)}
                className={`text-left rounded-xl border-2 p-4 transition-all ${
                  selectedStyle === style.id
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                {/* Visual Preview */}
                <div className="mb-3 rounded-lg bg-white/5 p-3 border border-white/5">
                  <p className={`text-xl font-bold tracking-tight text-white ${example.font}`}>
                    {example.preview}
                  </p>
                  {example.brands && (
                    <p className="mt-1 text-[10px] text-zinc-600">Like: {example.brands}</p>
                  )}
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">{style.label}</span>
                  {style.id === topStyle.id && (
                    <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-[10px] font-medium text-green-400">
                      ★ Top Pick
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 line-clamp-2">{style.reason}</p>
                <div className="mt-2 flex items-center gap-1">
                  <div className="h-1 flex-1 rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${style.confidence * 10}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-600">{style.confidence}/10</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Color Recommendations */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Color Palette</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.colorRecommendations.map((color) => (
            <button
              key={color.id}
              onClick={() => onSelectColor(color.id)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                selectedColor === color.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-white/10 bg-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex gap-1 mb-2">
                {color.colors.map((c, i) => (
                  <div
                    key={i}
                    className="h-6 w-6 rounded-md border border-white/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white">{color.label}</span>
                {color.id === topColor.id && (
                  <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-[10px] font-medium text-green-400">
                    ★
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-zinc-500 line-clamp-2">{color.reason}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Layout Recommendations */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Layout</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {data.layoutRecommendations.map((layout) => (
            <button
              key={layout.id}
              onClick={() => onSelectLayout(layout.id)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                selectedLayout === layout.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-white/10 bg-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-white">{layout.label}</span>
                {layout.id === topLayout.id && (
                  <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-[10px] font-medium text-green-400">
                    ★
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                {layout.id === 'wordmark'
                  ? 'Text-only logo: the brand name becomes the identity, with no separate icon or symbol.'
                  : layout.reason}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      {selectedLayout && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs text-blue-100">
          Selected: <strong>{selectedLayout === 'wordmark' ? 'Wordmark — brand name only, no icon' : selectedLayout === 'stacked' ? 'Stacked — symbol above the brand name' : 'Symbol + Wordmark — icon beside the brand name'}</strong>
        </div>
      )}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onGenerate}
          className="rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white hover:bg-blue-500 transition-colors"
        >
          Generate Logo →
        </button>
      </div>
    </div>
  );
}
