import { WizardData, LogoResult, QualityScore, AiRecommendations } from './types';

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
    const retryAfter = res.headers.get('Retry-After');
    const suffix = res.status === 429 && retryAfter
      ? ` Try again in ${retryAfter} seconds.`
      : '';
    throw new Error(`${data.error || `Request failed (${res.status})`}${suffix}`);
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
  improvementNotes?: string[],
): Promise<LogoResult> {
  return apiCall<LogoResult>('generate-logo', {
    brandName: data.brandName,
    description: data.description,
    style: data.style,
    colorPreference: data.colorPreference,
    layout: data.layout,
    referenceImages: data.referenceImages,
    variationSeed: crypto.randomUUID(),
    improvementNotes,
    researchContext: research?.slice(0, 2000),
  });
}

export async function reviewLogo(
  imageUrl: string,
  brandName: string,
  description?: string,
  _userApiKey?: string, // Ignored - keys are server-side only
): Promise<QualityScore> {
  return apiCall<QualityScore>('review-logo', {
    imageUrl,
    brandName,
    description,
  });
}

export async function vectorizeLogo(imageUrl: string, brandName: string, description?: string): Promise<{ imageUrl: string }> {
  return apiCall<{ imageUrl: string }>('vectorize-logo', { imageUrl, brandName, description });
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
