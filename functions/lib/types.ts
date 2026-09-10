// ─── Wizard Steps ──────────────────────────────────────

export interface WizardData {
  brandName: string;
  description: string;
  style?: string;
  colorPreference?: string;
  layout?: string;
  referenceImages: string[];
}

export type WizardStep =
  | 'input'
  | 'research'
  | 'refine'
  | 'generating'
  | 'result';

// ─── AI Research & Recommendations ─────────────────────

export interface AiRecommendations {
  industry: string;
  industryReasoning: string;
  styleRecommendations: {
    id: string;
    label: string;
    reason: string;
    confidence: number; // 1-10
  }[];
  colorRecommendations: {
    id: string;
    label: string;
    colors: string[]; // hex codes
    reason: string;
    confidence: number;
  }[];
  layoutRecommendations: {
    id: string;
    label: string;
    reason: string;
    confidence: number;
  }[];
  brandPersonality: string[];
  competitorContext: string;
}

// ─── Generation Result ─────────────────────────────────

export interface LogoResult {
  imageUrl: string;
  generationId: string;
}

export interface QualityScore {
  overall: number;
  scores: {
    simplicity: number;
    memorability: number;
    scalability: number;
    authority: number;
    cleverness: number;
    timelessness: number;
    billionDollarFeel: number;
  };
  feedback: string;
  suggestions: string[];
  approved: boolean;
}

// ─── Admin: API Provider ───────────────────────────────

export interface ApiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  textModel: string;
  imageModel: string;
  isActive: boolean;
}

// ─── Admin: Knowledge Base ─────────────────────────────

export interface KnowledgeBaseItem {
  id: string;
  imageData: string;
  filename: string;
  category: string;
  tags: string[];
  description: string;
  createdAt: string;
}

// ─── Admin: Settings ───────────────────────────────────

export interface AppSettings {
  defaultProviderId: string;
  maxIterations: number;
  imageQuality: 'standard' | 'hd';
  imageSize: '1024x1024' | '1792x1024' | '1024x1792';
  autoApprove: boolean;
  knowledgeBaseEnabled: boolean;
}
