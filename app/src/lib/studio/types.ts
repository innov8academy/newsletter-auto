import type { NewsletterDraft, StoryBlock } from '../draft-generator';

export type PresetId = 'nano-pro-2k' | 'gpt-image-2-high';
export type ReferenceRole = 'style' | 'news' | 'subject' | 'edit-source';
export type AssetRole = ReferenceRole | 'output' | 'delivery';
export type StudioStory = StoryBlock & {
  studioStoryId: string;
  sourceStoryId?: string;
};
export type StudioDraft = Omit<
  NewsletterDraft,
  'stories' | 'storageSchemaVersion'
> & { studioDraftId: string; storageSchemaVersion: 3; stories: StudioStory[] };
export interface DraftRecord {
  id: string;
  payload: StudioDraft;
  revision: number;
  updatedAt: string;
}
export interface ReferenceSelection {
  assetId: string;
  role: 'news' | 'subject';
  note: string;
}
export interface ReferenceManifestEntry {
  id: string;
  role: ReferenceRole;
  name: string;
  note: string;
}
export interface BufferedReference extends ReferenceManifestEntry {
  bytes: Buffer;
  mimeType: string;
}
export interface CostReceipt {
  id?: string;
  model: string;
  amountUsd: number | null;
  basis: 'provider' | 'usage' | 'unknown';
  outputEstimateUsd?: number;
  pricingDate: string;
  usage: Record<string, unknown>;
}
export interface StyleProfile {
  description: string;
  palette: string[];
  texture: string;
  composition: string[];
  avoid: string[];
}
export interface StudioAsset {
  id: string;
  draftId: string | null;
  role: AssetRole;
  status: 'pending' | 'ready' | 'rejected';
  name: string;
  originalPath: string;
  conditioningPath: string | null;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  checksum: string;
  eligibleForConditioning: boolean;
  tags: string[];
  palette: string[];
  texture: string;
  sourcePageUrl: string | null;
  originalUrl: string | null;
  rejectionReason?: string;
  previewUrl?: string;
  createdAt: string;
}
export interface StylePack {
  id: string;
  slug: string;
  version: number;
  name: string;
  profile: StyleProfile;
  assetIds: string[];
  anchorIds: string[];
  active: boolean;
  analysisCost?: CostReceipt;
  createdAt: string;
}
export interface ImagePlan {
  systemVersion?: string;
  storyThesis: string;
  entities: string[];
  scene: string;
  metaphor: string;
  composition: string;
  palette: string[];
  focalPoint: string;
  mustInclude: string[];
  avoid: string[];
  referenceUsage: { id: string; use: string }[];
  renderPrompt: string;
  altText: string;
  uncertainties: string[];
  inputSignature: string;
  inputHash: string;
  references: ReferenceManifestEntry[];
  model: string;
  cost: CostReceipt;
  createdAt: string;
}
export interface StoryWorkspace {
  draftId: string;
  storyId: string;
  revision: number;
  direction: string;
  stylePackId: string | null;
  styleDisabled?: boolean;
  references: ReferenceSelection[];
  plan: ImagePlan | null;
  manualPrompt: string | null;
  manualApprovedSignature: string | null;
  selectedGenerationId: string | null;
  presetId: PresetId;
}
export interface QualityCheck {
  status: 'checked' | 'unavailable';
  scores?: {
    relevance: number;
    fidelity: number;
    style: number;
    readability: number;
  };
  findings: string[];
  suggestedEdit: string;
  cost?: CostReceipt;
}
export interface GenerationRun {
  id: string;
  draftId: string;
  storyId: string;
  requestHash: string;
  presetId: PresetId;
  operation: 'generate' | 'edit';
  status: 'running' | 'complete' | 'failed' | 'interrupted' | 'save_failed';
  prompt: string;
  plan: ImagePlan | null;
  stage?: 'references' | 'planning' | 'rendering' | 'saving' | 'quality';
  warnings?: string[];
  inputSnapshot?: Record<string, unknown>;
  references: ReferenceManifestEntry[];
  originalAssetId: string | null;
  deliveryAssetId: string | null;
  providerRequestId: string | null;
  provider: string;
  model: string;
  costs: CostReceipt[];
  quality: QualityCheck | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
export interface SearchCandidate {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
  sourcePageUrl: string | null;
}
