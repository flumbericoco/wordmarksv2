import { WizardData } from './types';

// ─── Research + Recommend Prompt ───────────────────────

export function buildResearchPrompt(brandName: string, description: string): string {
  return `You are an elite typography-focused brand strategist and creative director specializing in wordmark logos.

Brand Name: "${brandName}"
Description: ${description || 'No description provided'}

We are wordmarks.net — a specialist in typography-first wordmark logos. Our entire craft is about making the brand name itself the logo through intelligent letterform design.

TASK:
1. Research and identify the industry/category this brand belongs to
2. Analyze the brand name's LETTERFORMS — what do the specific letters lend themselves to?
3. Recommend TYPOGRAPHIC sub-styles (not generic design styles) that would work best
4. Recommend color palettes that complement the typography
5. Recommend layout type that works for this specific letter combination
6. Describe the brand personality in 3-5 words

TYPOGRAPHIC SUB-STYLE OPTIONS (recommend 3-5):
- "geometric" — Clean geometric letterforms, precise angles, mathematical proportions
- "humanist" — Warm, organic letterforms with subtle hand-drawn feel
- "neo-grotesque" — Neutral, efficient, modern sans-serif like Helvetica/Inter
- "didone" — High contrast serif, editorial luxury, fashion-forward
- "slab-serif" — Strong, confident, architectural serifs
- "display" — Bold, attention-grabbing, custom display lettering
- "monospace" — Technical, developer-friendly, code-inspired
- "blackletter" — Heritage, authority, tradition with modern twist
- "script-influenced" — Subtle calligraphic touches in otherwise clean letterforms
- "stencil" — Military precision, industrial, modern utility
- "rounded" — Friendly, approachable, soft geometry
- "condensed" — Space-efficient, editorial, news-media feel

Be specific. Analyze the actual letters in "${brandName}" — which letters have interesting shapes? Where can negative space be used? What letter combinations create visual opportunities?

Output as JSON:
{
  "industry": "Specific industry category",
  "industryReasoning": "Why this industry classification",
  "brandPersonality": ["word1", "word2", "word3"],
  "competitorContext": "How competitors typically look and how to differentiate",
  "letterformAnalysis": "Analysis of the specific letters in the brand name",
  "styleRecommendations": [
    {
      "id": "geometric",
      "label": "Geometric",
      "reason": "Specific reason based on the actual letterforms of this brand name",
      "confidence": 8
    }
  ],
  "colorRecommendations": [
    {
      "id": "navy",
      "label": "Deep Navy",
      "colors": ["#0a1628", "#1e3a5f", "#3b82f6"],
      "reason": "Why these colors complement the typographic style",
      "confidence": 9
    }
  ],
  "layoutRecommendations": [
    {
      "id": "horizontal",
      "label": "Horizontal Wordmark",
      "reason": "Why this layout works for this specific letter combination",
      "confidence": 8
    }
  ]
}

Include 3-5 style recommendations, 3-4 color recommendations, and 2-3 layout recommendations.
Sort by confidence (highest first).
Each recommendation must reference the SPECIFIC LETTERS in the brand name — not generic advice.

Output ONLY valid JSON, no markdown, no code blocks.`;
}

// ─── Logo Generation Prompt ────────────────────────────

export function buildDallePrompt(data: WizardData, research?: string): string {
  let prompt = `Create a premium typography-first wordmark logo for "${data.brandName}".

This is a TYPOGRAPHIC LOGO — the brand name itself IS the logo. No icons, no symbols, no illustrations. Pure typography with intelligent letterform design.`;

  if (research) {
    prompt += `\n\nRESEARCH & LETTERFORM ANALYSIS:\n${research}`;
  }

  if (data.description) {
    prompt += `\n\nWHAT THE BRAND DOES: ${data.description}`;
  }

  if (data.style) {
    prompt += `\n\nTYPOGRAPHIC STYLE: ${data.style}`;
  }

  if (data.colorPreference) {
    prompt += `\n\nCOLOR PALETTE: ${data.colorPreference}`;
  }

  if (data.layout) {
    prompt += `\n\nLAYOUT: ${data.layout}`;
  }

  prompt += `

TYPOGRAPHY-FIRST RULES:
- The brand name "${data.brandName}" MUST be clearly readable as custom lettering
- This is NOT a font — every letter should feel hand-crafted and custom-designed
- The typography IS the entire logo — no separate icon, symbol, or illustration
- Use intelligent letterform modifications: custom curves, negative space, geometric precision
- Look for opportunities in the specific letters: shared strokes, ligatures, negative space between letters
- The wordmark should feel like it was designed by a world-class type designer
- No clipart, no stock icons, no decorative elements
- Maximum 2 colors (primary + accent)
- Clean solid background (white, black, or deep navy)
- The result should look like a premium brand worth billions

TYPOGRAPHIC INSPIRATION: Stripe wordmark, Linear logo, Notion wordmark, Vercel triangle-wordmark, OpenAI logotype.
The typography must feel timeless, premium, and instantly memorable after one glance.`;

  return prompt;
}

export function buildIdentityLogoPrompt(
  data: WizardData,
  options?: { variationSeed?: string; improvementNotes?: string[]; research?: string },
): string {
  const layout = data.layout || 'icon-word';
  const notes = options?.improvementNotes?.length
    ? `\nREVIEW IMPROVEMENTS:\n- ${options.improvementNotes.join('\n- ')}`
    : '';
  return `Design one original, production-ready brand identity logo for "${data.brandName}".

BRAND BRIEF: ${data.description || 'A modern brand that needs a distinctive, trustworthy identity.'}
STYLE: ${data.style || 'modern, confident, timeless'}
COLOR DIRECTION: ${data.colorPreference || 'a restrained professional palette with one accent color'}
COMPOSITION: ${layout}. Unless the user explicitly selected a pure wordmark, create a distinctive abstract symbol plus a custom wordmark. The symbol must have a clear idea derived from the brand name, initials, purpose, or motion—not a generic stock icon.
VARIATION KEY: ${options?.variationSeed || 'initial-concept'}
${options?.research ? `STRATEGIC CONTEXT: ${options.research.slice(0, 1800)}` : ''}${notes}

ART DIRECTION:
- Deliver a coherent symbol + wordmark lockup comparable to a polished SaaS identity presentation.
- Spell "${data.brandName}" exactly once and keep it immediately readable.
- Build the symbol from simple geometric vector shapes with a memorable silhouette and meaningful negative space.
- Use consistent optical weight, spacing, corner language, and alignment between symbol and lettering.
- Maximum three flat colors. Avoid mockups, photos, gradients unless subtle and essential, shadows, bevels, 3D, mascots, decorative clutter, taglines, and extra text.
- Transparent artboard: do not draw a full-canvas background rectangle.
- Make it work at favicon size and in monochrome.
- Create a genuinely different concept for every variation key; do not merely recolor the previous idea.
- Return only the finished logo artwork, centered with generous clear space.`;
}

export function getVisualQualityReviewPrompt(svgMarkup: string, brandName: string, brief?: string): string {
  return `Act as a strict senior identity designer. Review the actual generated SVG artwork below—not its generation prompt.

BRAND: ${brandName}
BRIEF: ${brief || 'Not provided'}
SVG ARTWORK:\n${svgMarkup.slice(0, 24000)}

First verify the exact brand spelling, then evaluate simplicity, memorability, small-size scalability, authority, originality, timelessness, and overall professional finish. Penalize generic symbols, weak alignment, accidental clipping, illegible text, excessive detail, and mismatch with the brief.

Return ONLY valid JSON:
{"overall":7.5,"scores":{"simplicity":8,"memorability":7,"scalability":8,"authority":7,"cleverness":7,"timelessness":8,"billionDollarFeel":7},"feedback":"Concise evidence-based critique of the visible artwork.","suggestions":["Specific visual improvement 1","Specific visual improvement 2","Specific visual improvement 3"],"approved":false}

Use numeric scores from 1 to 10. approved is true only when overall is at least 9 and no spelling or legibility problem exists.`;
}

// ─── Quality Review Prompt ─────────────────────────────

export function getQualityReviewPrompt(revisedPrompt: string, brandName: string): string {
  return `You are an expert logo designer evaluating a generated wordmark logo for "${brandName}".

The logo was generated with this prompt: ${revisedPrompt}

Evaluate the logo on these 7 dimensions (score 1-10 each):

1. SIMPLICITY — Is it clean, uncluttered, minimalist?
2. MEMORABILITY — Will you remember it after seeing it once?
3. SCALABILITY — Does it work at favicon size AND large banner?
4. AUTHORITY — Does it feel premium, trustworthy, professional?
5. CLEVERNESS — Are there intelligent design elements (negative space, hidden meaning)?
6. TIMELESSNESS — Will this look good in 20 years?
7. BILLION DOLLAR FEEL — Does this look like a company worth billions?

Output as JSON:
{
  "overall": <average score rounded to 1 decimal>,
  "scores": {
    "simplicity": <1-10>,
    "memorability": <1-10>,
    "scalability": <1-10>,
    "authority": <1-10>,
    "cleverness": <1-10>,
    "timelessness": <1-10>,
    "billionDollarFeel": <1-10>
  },
  "feedback": "Detailed feedback on strengths and weaknesses",
  "suggestions": ["Specific improvement suggestion 1", "Suggestion 2", "Suggestion 3"],
  "approved": <true if overall >= 9, false otherwise>
}

Be strict. Only approve if it genuinely looks premium and iconic.

Output ONLY valid JSON, no markdown, no code blocks.`;
}

// ─── Iteration Prompt ──────────────────────────────────

export function getIterationPrompt(
  originalPrompt: string,
  feedback: string,
  suggestions: string[],
  data: WizardData
): string {
  return `You are refining a logo generation prompt based on quality review feedback.

ORIGINAL PROMPT:
${originalPrompt}

FEEDBACK:
${feedback}

IMPROVEMENT SUGGESTIONS:
${suggestions.join('\n')}

BRAND: ${data.brandName}
DESCRIPTION: ${data.description || 'N/A'}
STYLE: ${data.style || 'recommended by AI'}
COLORS: ${data.colorPreference || 'recommended by AI'}
LAYOUT: ${data.layout || 'recommended by AI'}

Create an IMPROVED prompt that:
1. Addresses the specific feedback points
2. Maintains the core brand identity
3. Results in a better logo on the next iteration
4. Still follows all premium wordmark design rules

Return ONLY the refined prompt as plain text (no JSON, no markdown).`;
}
