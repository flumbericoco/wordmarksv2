import { WizardData, LogoResult, QualityScore, AiRecommendations } from './types';
import { buildResearchPrompt, buildDallePrompt, getQualityReviewPrompt, getIterationPrompt } from './prompts';

// ─── Server API Client ──────────────────────────────────
// All API calls go through this deployment's Cloudflare Pages Functions.
// API keys are NEVER exposed to the browser

const API_BASE = '/api/v1';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  requestId: string;
}

async function apiCall<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Network error: cannot reach server. Check your internet connection or try again.'
    );
  }

  // Parse response defensively
  let data: ApiResponse<T>;
  try {
    data = await res.json() as ApiResponse<T>;
  } catch {
    throw new Error('Invalid server response. Please try again.');
  }

  if (!data.ok) {
    // Use server-provided error message (already sanitized)
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data.data as T;
}

// ─── Public API Functions ───────────────────────────────

export async function researchBrand(
  brandName: string,
  description: string,
  _userApiKey?: string, // Ignored - keys are server-side only
): Promise<AiRecommendations> {
  return apiCall<AiRecommendations>('research', {
    brandName,
    description,
  });
}

export async function generateLogo(
  data: WizardData,
  research?: string,
  _userApiKey?: string, // Ignored - keys are server-side only
): Promise<LogoResult> {
  return apiCall<LogoResult>('generate-logo', {
    brandName: data.brandName,
    description: data.description,
    style: data.style,
    colorPreference: data.colorPreference,
    layout: data.layout,
    referenceImages: data.referenceImages,
  });
}

export async function reviewLogo(
  revisedPrompt: string,
  brandName: string,
  _userApiKey?: string, // Ignored - keys are server-side only
): Promise<QualityScore> {
  return apiCall<QualityScore>('review-logo', {
    revisedPrompt,
    brandName,
  });
}

export async function iterateLogo(
  originalPrompt: string,
  feedback: string,
  suggestions: string[],
  data: WizardData,
  _userApiKey?: string, // Ignored - keys are server-side only
): Promise<string> {
  return apiCall<string>('iterate-logo', {
    originalPrompt,
    feedback,
    suggestions,
    data: {
      brandName: data.brandName,
      description: data.description,
      style: data.style,
      colorPreference: data.colorPreference,
      layout: data.layout,
    },
  });
}
