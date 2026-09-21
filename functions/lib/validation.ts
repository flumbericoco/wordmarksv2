// ─── Runtime Validation (no Zod dependency) ────────────

export type ValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; error: string };

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && !isNaN(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

// ─── Research Request ───────────────────────────────────

export interface ResearchRequest {
  brandName: string;
  description?: string;
}

export function validateResearchRequest(body: unknown): ValidationResult<ResearchRequest> {
  if (!isObject(body)) return { valid: false, error: 'Request body must be a JSON object' };
  const { brandName, description } = body;

  if (!isString(brandName) || brandName.trim().length === 0) {
    return { valid: false, error: 'brandName is required and must be a non-empty string' };
  }
  if (brandName.length > 100) {
    return { valid: false, error: 'brandName must be 100 characters or less' };
  }
  if (description !== undefined && (!isString(description) || description.length > 500)) {
    return { valid: false, error: 'description must be a string of 500 characters or less' };
  }

  return {
    valid: true,
    data: {
      brandName: brandName.trim(),
      description: description?.trim() || undefined,
    },
  };
}

// ─── Generate Request ───────────────────────────────────

export interface GenerateRequest {
  brandName: string;
  description?: string;
  style?: string;
  colorPreference?: string;
  layout?: string;
  referenceImages?: string[];
  variationSeed?: string;
  improvementNotes?: string[];
  researchContext?: string;
}

export function validateGenerateRequest(body: unknown): ValidationResult<GenerateRequest> {
  if (!isObject(body)) return { valid: false, error: 'Request body must be a JSON object' };
  const { brandName, description, style, colorPreference, layout, referenceImages, variationSeed, improvementNotes, researchContext } = body;

  if (!isString(brandName) || brandName.trim().length === 0) {
    return { valid: false, error: 'brandName is required' };
  }
  if (brandName.length > 100 || (description !== undefined && (!isString(description) || description.length > 500))) {
    return { valid: false, error: 'Brand name or description is too long' };
  }
  if (brandName.length > 100) {
    return { valid: false, error: 'brandName must be 100 characters or less' };
  }
  if (description !== undefined && (!isString(description) || description.length > 500)) {
    return { valid: false, error: 'description must be a string of 500 characters or less' };
  }
  if (style !== undefined && (!isString(style) || style.length > 100)) {
    return { valid: false, error: 'style must be 100 characters or less' };
  }
  if (colorPreference !== undefined && (!isString(colorPreference) || colorPreference.length > 100)) {
    return { valid: false, error: 'colorPreference must be a string' };
  }
  if (layout !== undefined && (!isString(layout) || layout.length > 100)) {
    return { valid: false, error: 'layout must be a string' };
  }
  if (referenceImages !== undefined) {
    if (!isArray(referenceImages)) {
      return { valid: false, error: 'referenceImages must be an array' };
    }
    if (referenceImages.length > 5) {
      return { valid: false, error: 'referenceImages must have 5 or fewer items' };
    }
    if (referenceImages.some((item) => !isString(item) || item.length > 1_500_000 || (!item.startsWith('data:image/') && !item.startsWith('https://')))) {
      return { valid: false, error: 'referenceImages contain an invalid or oversized image' };
    }
  }
  if (variationSeed !== undefined && (!isString(variationSeed) || variationSeed.length > 100)) {
    return { valid: false, error: 'variationSeed must be a short string' };
  }
  if (improvementNotes !== undefined && (!isArray(improvementNotes) || improvementNotes.length > 5 || improvementNotes.some((note) => !isString(note) || note.length > 240))) {
    return { valid: false, error: 'improvementNotes must contain up to 5 short strings' };
  }
  if (researchContext !== undefined && (!isString(researchContext) || researchContext.length > 2000)) {
    return { valid: false, error: 'researchContext must be 2000 characters or less' };
  }

  return {
    valid: true,
    data: {
      brandName: brandName.trim(),
      description: description?.trim() || undefined,
      style: style?.trim() || undefined,
      colorPreference: colorPreference?.trim() || undefined,
      layout: layout?.trim() || undefined,
      referenceImages: isArray(referenceImages) ? (referenceImages as string[]) : undefined,
      variationSeed: isString(variationSeed) ? variationSeed : undefined,
      improvementNotes: isArray(improvementNotes) ? improvementNotes as string[] : undefined,
      researchContext: isString(researchContext) ? researchContext : undefined,
    },
  };
}

// ─── Review Request ─────────────────────────────────────

export interface ReviewRequest {
  imageUrl: string;
  brandName: string;
  description?: string;
  generationId?: string;
}

export function validateReviewRequest(body: unknown): ValidationResult<ReviewRequest> {
  if (!isObject(body)) return { valid: false, error: 'Request body must be a JSON object' };
  const { imageUrl, brandName, description, generationId } = body;

  if (!isString(imageUrl) || (!imageUrl.startsWith('data:image/') && !imageUrl.startsWith('https://')) || imageUrl.length > 7_000_000) {
    return { valid: false, error: 'A valid generated image is required' };
  }
  if (!isString(brandName) || brandName.trim().length === 0) {
    return { valid: false, error: 'brandName is required' };
  }

  return {
    valid: true,
    data: {
      imageUrl,
      brandName: brandName.trim(),
      description: isString(description) ? description.trim() : undefined,
      generationId: isString(generationId) && /^[a-f0-9-]{20,64}$/i.test(generationId) ? generationId : undefined,
    },
  };
}

// ─── Iterate Request ────────────────────────────────────

export interface IterateRequest {
  originalPrompt: string;
  feedback: string;
  suggestions: string[];
  data: {
    brandName: string;
    description?: string;
    style?: string;
    colorPreference?: string;
    layout?: string;
  };
}

export function validateIterateRequest(body: unknown): ValidationResult<IterateRequest> {
  if (!isObject(body)) return { valid: false, error: 'Request body must be a JSON object' };
  const { originalPrompt, feedback, suggestions, data } = body;

  if (!isString(originalPrompt) || originalPrompt.trim().length === 0 || originalPrompt.length > 10_000) {
    return { valid: false, error: 'originalPrompt is required' };
  }
  if (!isString(feedback) || feedback.trim().length === 0 || feedback.length > 2_000) {
    return { valid: false, error: 'feedback is required' };
  }
  if (!isArray(suggestions) || suggestions.length > 10 || suggestions.some((item) => !isString(item) || item.length > 500)) {
    return { valid: false, error: 'suggestions must be an array' };
  }
  if (!isObject(data) || !isString(data.brandName)) {
    return { valid: false, error: 'data.brandName is required' };
  }
  if (data.brandName.length > 100 || (isString(data.description) && data.description.length > 500)) {
    return { valid: false, error: 'Iteration brand data is too long' };
  }

  return {
    valid: true,
    data: {
      originalPrompt: originalPrompt.trim(),
      feedback: feedback.trim(),
      suggestions: suggestions.map(String),
      data: {
        brandName: String(data.brandName).trim(),
        description: isString(data.description) ? data.description.trim() : undefined,
        style: isString(data.style) ? data.style.trim() : undefined,
        colorPreference: isString(data.colorPreference) ? data.colorPreference.trim() : undefined,
        layout: isString(data.layout) ? data.layout.trim() : undefined,
      },
    },
  };
}

// ─── Provider Create/Update Request ─────────────────────

export interface ProviderRequest {
  name: string;
  baseUrl: string;
  apiKey?: string;
  textModel: string;
  imageModel?: string;
  isActive?: boolean;
}

export function validateProviderRequest(body: unknown): ValidationResult<ProviderRequest> {
  if (!isObject(body)) return { valid: false, error: 'Request body must be a JSON object' };
  const { name, baseUrl, apiKey, textModel, imageModel, isActive } = body;

  if (!isString(name) || name.trim().length === 0) {
    return { valid: false, error: 'name is required' };
  }
  if (name.length > 100 || (isString(textModel) && textModel.length > 200) || (isString(imageModel) && imageModel.length > 200)) {
    return { valid: false, error: 'Provider fields are too long' };
  }
  if (!isString(baseUrl) || baseUrl.trim().length === 0) {
    return { valid: false, error: 'baseUrl is required' };
  }
  if (!isString(textModel) || textModel.trim().length === 0) {
    return { valid: false, error: 'textModel is required' };
  }
  if (apiKey !== undefined && !isString(apiKey)) {
    return { valid: false, error: 'apiKey must be a string' };
  }
  if (imageModel !== undefined && !isString(imageModel)) {
    return { valid: false, error: 'imageModel must be a string' };
  }

  return {
    valid: true,
    data: {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: isString(apiKey) ? apiKey : undefined,
      textModel: textModel.trim(),
      imageModel: isString(imageModel) ? imageModel.trim() : undefined,
      isActive: typeof isActive === 'boolean' ? isActive : undefined,
    },
  };
}

// ─── Settings Update Request ────────────────────────────

export interface SettingsRequest {
  systemPrompt?: string;
  negativePrompt?: string;
  defaultProviderId?: string;
  maxIterations?: number;
  imageQuality?: 'standard' | 'hd';
  imageSize?: '1024x1024' | '1792x1024' | '1024x1792';
  autoApprove?: boolean;
  knowledgeBaseEnabled?: boolean;
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalMode?: 'sandbox' | 'live';
  paypalWebhookId?: string;
}

export function validateSettingsRequest(body: unknown): ValidationResult<SettingsRequest> {
  if (!isObject(body)) return { valid: false, error: 'Request body must be a JSON object' };

  const result: SettingsRequest = {};
  const b = body as Record<string, unknown>;

  if (b.systemPrompt !== undefined) {
    if (!isString(b.systemPrompt) || b.systemPrompt.length > 20_000) return { valid: false, error: 'systemPrompt must be at most 20,000 characters' };
    result.systemPrompt = b.systemPrompt.trim();
  }
  if (b.negativePrompt !== undefined) {
    if (!isString(b.negativePrompt) || b.negativePrompt.length > 5_000) return { valid: false, error: 'negativePrompt must be at most 5,000 characters' };
    result.negativePrompt = b.negativePrompt.trim();
  }

  if (b.defaultProviderId !== undefined) {
    if (!isString(b.defaultProviderId)) return { valid: false, error: 'defaultProviderId must be a string' };
    result.defaultProviderId = b.defaultProviderId;
  }
  if (b.maxIterations !== undefined) {
    if (!isNumber(b.maxIterations) || b.maxIterations < 1 || b.maxIterations > 10) {
      return { valid: false, error: 'maxIterations must be between 1 and 10' };
    }
    result.maxIterations = b.maxIterations;
  }
  if (b.imageQuality !== undefined) {
    if (b.imageQuality !== 'standard' && b.imageQuality !== 'hd') {
      return { valid: false, error: 'imageQuality must be "standard" or "hd"' };
    }
    result.imageQuality = b.imageQuality;
  }
  if (b.imageSize !== undefined) {
    const validSizes = ['1024x1024', '1792x1024', '1024x1792'];
    if (!validSizes.includes(b.imageSize as string)) {
      return { valid: false, error: 'imageSize must be one of: 1024x1024, 1792x1024, 1024x1792' };
    }
    result.imageSize = b.imageSize as SettingsRequest['imageSize'];
  }
  if (b.autoApprove !== undefined) {
    if (typeof b.autoApprove !== 'boolean') return { valid: false, error: 'autoApprove must be a boolean' };
    result.autoApprove = b.autoApprove;
  }
  if (b.knowledgeBaseEnabled !== undefined) {
    if (typeof b.knowledgeBaseEnabled !== 'boolean') return { valid: false, error: 'knowledgeBaseEnabled must be a boolean' };
    result.knowledgeBaseEnabled = b.knowledgeBaseEnabled;
  }

  return { valid: true, data: result };
}

// ─── Knowledge Base Item Request ────────────────────────

export interface KnowledgeBaseRequest {
  filename: string;
  category?: string;
  tags?: string[];
  description?: string;
  imageData?: string;
}

export function validateKnowledgeBaseRequest(body: unknown): ValidationResult<KnowledgeBaseRequest> {
  if (!isObject(body)) return { valid: false, error: 'Request body must be a JSON object' };
  const { filename, category, tags, description, imageData } = body;

  if (!isString(filename) || filename.trim().length === 0) {
    return { valid: false, error: 'filename is required' };
  }
  if (filename.length > 180 || (isString(category) && category.length > 80) || (isString(description) && description.length > 20_000)) {
    return { valid: false, error: 'Knowledge base fields are too long' };
  }
  if (category !== undefined && !isString(category)) {
    return { valid: false, error: 'category must be a string' };
  }
  if (tags !== undefined && !isArray(tags)) {
    return { valid: false, error: 'tags must be an array' };
  }
  if (isArray(tags) && (tags.length > 30 || tags.some((tag) => !isString(tag) || tag.length > 80))) {
    return { valid: false, error: 'tags must contain up to 30 short strings' };
  }
  if (description !== undefined && !isString(description)) {
    return { valid: false, error: 'description must be a string' };
  }
  if (imageData !== undefined && !isString(imageData)) {
    return { valid: false, error: 'imageData must be a string' };
  }

  // Limit imageData size (5MB base64 ~ 3.75MB raw)
  if (isString(imageData) && imageData.length > 7_000_000) {
    return { valid: false, error: 'imageData exceeds 5MB limit' };
  }

  return {
    valid: true,
    data: {
      filename: filename.trim(),
      category: isString(category) ? category.trim() : undefined,
      tags: isArray(tags) ? tags.map(String) : undefined,
      description: isString(description) ? description.trim() : undefined,
      imageData: isString(imageData) ? imageData : undefined,
    },
  };
}
