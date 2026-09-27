import type { NewsletterDraft } from './draft-generator';
import type { ResearchReport } from './types';
import { browserStorage } from './browser-storage';
import { createUuid } from './uuid';
import {
  MAX_NEWSLETTER_STORIES,
  SharedSelectionError,
  loadSharedSelection,
  saveSharedSelection,
  validResearchReports,
  type SharedSelectionState,
} from './storage';

type SessionContent = Omit<SharedSelectionState, 'revision' | 'updatedAt'>;
type SessionPatch = Partial<SessionContent>;
type Phase = 'loading' | 'ready' | 'saving' | 'load_error' | 'save_error' | 'auth' | 'conflict';

interface PendingChange {
  baseSessionId: string;
  expectedRevision: number;
  state: SharedSelectionState;
}

export interface SharedSessionSnapshot {
  phase: Phase;
  state: SharedSelectionState | null;
  message: string;
  pending: boolean;
  latest: SharedSelectionState | null;
  legacyReports: number;
  legacyDraft: boolean;
  legacyAvailable: boolean;
}

const MIRROR_KEY = 'newsletter_shared_session_id';
const LEGACY_KEY = 'newsletter_legacy_backup';
const PENDING_TAB_KEY = 'newsletter_shared_tab_id';
const PENDING_PREFIX = 'newsletter_shared_pending_';

function tabId(): string {
  if (typeof window === 'undefined') return createUuid();
  try {
    const existing = window.sessionStorage.getItem(PENDING_TAB_KEY);
    if (existing) return existing;
    const next = createUuid();
    window.sessionStorage.setItem(PENDING_TAB_KEY, next);
    return next;
  } catch {
    return createUuid();
  }
}

function reportIds(reports: ResearchReport[]): string[] {
  return reports.map(report => report.story.id);
}

function isCompatibleWizard(value: unknown, allowedIds: Set<string>): boolean {
  if (!value || typeof value !== 'object') return false;
  const wizard = value as Record<string, unknown>;
  if (!Array.isArray(wizard.selectedReports) || !wizard.selectedReports.length || wizard.selectedReports.length > MAX_NEWSLETTER_STORIES) return false;
  const reports = validResearchReports(wizard.selectedReports);
  return reports.length === wizard.selectedReports.length && reports.every(report => allowedIds.has(report.story.id));
}

function compatibleDraft(value: unknown, allowedIds: Set<string>): value is NewsletterDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<NewsletterDraft>;
  return Array.isArray(draft.stories) && draft.stories.length > 0 && draft.stories.length <= MAX_NEWSLETTER_STORIES &&
    draft.stories.every(story => story && typeof story.sourceStoryId === 'string' && allowedIds.has(story.sourceStoryId));
}

function validatedState(state: SharedSelectionState): SharedSelectionState {
  if (state.selectedIds.length > MAX_NEWSLETTER_STORIES || state.researchReports.length > MAX_NEWSLETTER_STORIES) {
    throw new Error(`A newsletter can contain at most ${MAX_NEWSLETTER_STORIES} selected or researched stories.`);
  }
  const wizard = state.wizardState as { selectedReports?: unknown } | null;
  if (wizard && Array.isArray(wizard.selectedReports) && wizard.selectedReports.length > MAX_NEWSLETTER_STORIES) {
    throw new Error(`A newsletter can contain at most ${MAX_NEWSLETTER_STORIES} stories.`);
  }
  if (state.currentDraft && Array.isArray(state.currentDraft.stories) && state.currentDraft.stories.length > MAX_NEWSLETTER_STORIES) {
    throw new Error(`A newsletter can contain at most ${MAX_NEWSLETTER_STORIES} stories.`);
  }
  return state;
}

/** One writer per tab. The server revision is the authority across tabs and devices. */
export class SharedSessionClient {
  private snapshot: SharedSessionSnapshot = {
    phase: 'loading', state: null, message: '', pending: false, latest: null,
    legacyReports: 0, legacyDraft: false,
    legacyAvailable: false,
  };
  private listeners = new Set<() => void>();
  private pending: PendingChange | null = null;
  private pendingKey: string;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private version = 0;
  private loading: Promise<void> | null = null;

  constructor(private storage: Storage = browserStorage, tab = tabId()) {
    this.pendingKey = PENDING_PREFIX + tab;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private emit(patch: Partial<SharedSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private readPending(): PendingChange | null {
    try {
      const raw = this.storage.getItem(this.pendingKey);
      if (!raw) return null;
      const value = JSON.parse(raw) as PendingChange;
      if (!value || typeof value.baseSessionId !== 'string' || !Number.isSafeInteger(value.expectedRevision) ||
        !value.state || typeof value.state.sessionId !== 'string') return null;
      return value;
    } catch { return null; }
  }

  private writePending() {
    if (this.pending) this.storage.setItem(this.pendingKey, JSON.stringify(this.pending));
    else this.storage.removeItem(this.pendingKey);
  }

  private backupLegacy() {
    if (this.storage.getItem(MIRROR_KEY) || this.storage.getItem(LEGACY_KEY)) return;
    const curatedRaw = this.storage.getItem('innov8_curated_stories');
    const selectedRaw = this.storage.getItem('innov8_selected_ids');
    const reportsRaw = this.storage.getItem('innov8_research_reports');
    let reports: ResearchReport[] = [];
    let selectedIds: string[] = [];
    let curatedStories: unknown[] = [];
    try { reports = validResearchReports(JSON.parse(reportsRaw || '[]')); } catch { /* original remains in storage */ }
    try {
      const stories = JSON.parse(curatedRaw || '[]');
      curatedStories = Array.isArray(stories) ? stories : [];
    } catch { /* original remains in storage */ }
    try {
      const ids = JSON.parse(selectedRaw || '[]');
      selectedIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    } catch { /* original remains in storage */ }
    const wizard = this.storage.getItem('newsletter-wizard-state');
    const draft = this.storage.getItem('currentDraft');
    if (!curatedStories.length && !selectedIds.length && !reportsRaw && !wizard && !draft) return;
    this.storage.setItem(LEGACY_KEY, JSON.stringify({
      curatedStories, curatedRaw, selectedIds, selectedRaw, reports, reportsRaw, wizard, draft,
    }));
  }

  private legacyFor(state: SharedSelectionState) {
    try {
      const raw = this.storage.getItem(LEGACY_KEY);
      if (!raw) return { count: 0, draft: false, available: false };
      const backup = JSON.parse(raw) as { selectedIds?: unknown; reports?: unknown; wizard?: string; draft?: string };
      const matching = validResearchReports(backup.reports).filter(report => state.selectedIds.includes(report.story.id));
      const allowed = new Set(reportIds(matching));
      const sameSelection = JSON.stringify(backup.selectedIds) === JSON.stringify(state.selectedIds);
      const wizard = backup.wizard ? JSON.parse(backup.wizard) : null;
      const draft = backup.draft ? JSON.parse(backup.draft) : null;
      return {
        available: this.storage.getItem(`${LEGACY_KEY}_dismissed`) !== '1',
        count: matching.filter(report => !state.researchReports.some(existing => existing.story.id === report.story.id)).length,
        draft: sameSelection && isCompatibleWizard(wizard, allowed) && compatibleDraft(draft, allowed) &&
          !state.wizardState && !state.currentDraft,
      };
    } catch { return { count: 0, draft: false, available: true }; }
  }

  private mirror(state: SharedSelectionState) {
    const previousSession = this.storage.getItem(MIRROR_KEY);
    if (previousSession && previousSession !== state.sessionId) {
      const oldDraft = this.storage.getItem('currentDraft');
      if (oldDraft) this.storage.setItem('studio_previous_draft_backup', oldDraft);
      for (const key of ['innov8_curated_stories', 'innov8_selected_ids', 'innov8_research_reports', 'innov8_last_updated', 'newsletter-wizard-state', 'currentDraft']) {
        this.storage.removeItem(key);
      }
    }
    this.storage.setItem('innov8_curated_stories', JSON.stringify(state.curatedStories));
    this.storage.setItem('innov8_selected_ids', JSON.stringify(state.selectedIds));
    this.storage.setItem('innov8_research_reports', JSON.stringify(state.researchReports));
    this.storage.setItem('innov8_last_updated', state.updatedAt || '');
    if (state.wizardState) this.storage.setItem('newsletter-wizard-state', JSON.stringify(state.wizardState));
    else this.storage.removeItem('newsletter-wizard-state');
    if (state.currentDraft) this.storage.setItem('currentDraft', JSON.stringify(state.currentDraft));
    else this.storage.removeItem('currentDraft');
    this.storage.setItem(MIRROR_KEY, state.sessionId);
  }

  async load(): Promise<void> {
    if (this.saving && this.snapshot.state) return;
    if (this.loading) return this.loading;
    const startVersion = this.version;
    this.loading = (async () => {
      if (!this.snapshot.state) this.emit({ phase: 'loading', message: '' });
      try {
        const result = await loadSharedSelection();
        if (!result.initialized || !result.state) {
          this.emit({ phase: 'load_error', message: 'The shared newsletter has not been initialized. Apply the session migration and retry.' });
          return;
        }
        const server = validatedState(result.state);
        this.backupLegacy();
        const pending = this.pending ?? this.readPending();
        if (pending) {
          this.pending = pending;
          if (pending.expectedRevision !== server.revision || pending.baseSessionId !== server.sessionId) {
            this.emit({ state: pending.state, phase: 'conflict', latest: server, pending: true,
              message: 'Another device changed this newsletter. Your local changes are saved on this device.' });
            return;
          }
          this.mirror(pending.state);
          this.emit({ state: pending.state, phase: 'saving', latest: null, pending: true, message: '' });
          this.scheduleFlush(0);
          return;
        }
        if (startVersion !== this.version) return;
        this.mirror(server);
        const legacy = this.legacyFor(server);
        this.emit({ state: server, phase: 'ready', latest: null, pending: false, message: '',
          legacyReports: legacy.count, legacyDraft: legacy.draft, legacyAvailable: legacy.available });
      } catch (cause) {
        const error = cause instanceof SharedSelectionError ? cause : null;
        this.emit({ phase: error?.status === 401 ? 'auth' : this.snapshot.state ? 'save_error' : 'load_error',
          message: error?.message || 'Could not load the shared newsletter. Retry when the connection is available.' });
      }
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  mutate(change: SessionPatch | ((state: SharedSelectionState) => SessionPatch)) {
    const current = this.snapshot.state;
    if (!current || this.snapshot.phase === 'loading' || this.snapshot.phase === 'load_error' || this.snapshot.phase === 'conflict') {
      throw new Error('Load the latest shared newsletter before changing it.');
    }
    const patch = typeof change === 'function' ? change(current) : change;
    const next = validatedState({ ...current, ...patch });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.version++;
    if (!this.pending) this.pending = { baseSessionId: current.sessionId, expectedRevision: current.revision, state: next };
    else this.pending.state = next;
    this.writePending();
    this.mirror(next);
    this.emit({ state: next, phase: 'saving', pending: true, message: '' });
    this.scheduleFlush(250);
  }

  reset() {
    this.mutate({ sessionId: createUuid(), curatedStories: [], selectedIds: [],
      researchReports: [], wizardState: null, currentDraft: null });
  }

  private scheduleFlush(delay: number) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, delay);
  }

  async flush(): Promise<void> {
    if (this.saving || !this.pending || this.snapshot.phase === 'conflict') return;
    this.saving = true;
    const sending = this.pending;
    const sentVersion = this.version;
    try {
      const { revision: _revision, updatedAt: _updatedAt, ...content } = sending.state;
      const saved = await saveSharedSelection(content, sending.expectedRevision);
      if (!this.pending || this.pending !== sending) return;
      if (sentVersion === this.version) {
        this.pending = null;
        this.writePending();
        this.mirror(saved);
        this.emit({ state: saved, phase: 'ready', pending: false, message: '', latest: null });
      } else {
        this.pending.expectedRevision = saved.revision;
        this.pending.baseSessionId = saved.sessionId;
        this.pending.state = { ...this.pending.state, revision: saved.revision, updatedAt: saved.updatedAt };
        this.writePending();
        this.emit({ state: this.pending.state, phase: 'saving', pending: true });
      }
    } catch (cause) {
      const error = cause instanceof SharedSelectionError ? cause : null;
      if (error?.status === 409 && error.latest) {
        this.emit({ phase: 'conflict', latest: error.latest, pending: true,
          message: 'Another device changed this newsletter. Your local changes are saved on this device.' });
      } else {
        this.emit({ phase: error?.status === 401 ? 'auth' : 'save_error', pending: true,
          message: error?.message || 'Could not save the shared newsletter. Your changes remain on this device.' });
      }
    } finally {
      this.saving = false;
      if (this.pending && this.snapshot.phase === 'saving') this.scheduleFlush(0);
    }
  }

  async waitForSaved(): Promise<boolean> {
    if (!this.pending) return this.snapshot.phase === 'ready';
    void this.flush();
    return new Promise(resolve => {
      let settled = false;
      const finish = (saved: boolean) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearTimeout(timeout);
        resolve(saved);
      };
      const unsubscribe = this.subscribe(() => {
        if (this.snapshot.phase === 'ready' && !this.pending) finish(true);
        else if (['save_error', 'auth', 'conflict', 'load_error'].includes(this.snapshot.phase)) finish(false);
      });
      const timeout = setTimeout(() => finish(false), 20000);
    });
  }

  async retry() {
    await this.load();
  }

  useLatest() {
    const latest = this.snapshot.latest;
    if (!latest) return;
    if (this.pending) this.storage.setItem(`newsletter_recovery_${Date.now()}`, JSON.stringify(this.pending.state));
    this.pending = null;
    this.writePending();
    this.version++;
    this.mirror(latest);
    this.emit({ state: latest, phase: 'ready', pending: false, latest: null, message: '' });
  }

  replaceShared() {
    const latest = this.snapshot.latest;
    if (!latest || !this.pending || latest.sessionId !== this.pending.baseSessionId) return;
    this.pending.expectedRevision = latest.revision;
    this.pending.baseSessionId = latest.sessionId;
    this.writePending();
    this.emit({ phase: 'saving', latest: null, message: '' });
    this.scheduleFlush(0);
  }

  importLegacy() {
    const state = this.snapshot.state;
    if (!state) return;
    try {
      const raw = this.storage.getItem(LEGACY_KEY);
      if (!raw) return;
      const backup = JSON.parse(raw) as { reports?: unknown; wizard?: string; draft?: string };
      const matching = validResearchReports(backup.reports).filter(report => state.selectedIds.includes(report.story.id));
      const current = new Set(reportIds(state.researchReports));
      const researchReports = [...state.researchReports, ...matching.filter(report => !current.has(report.story.id))];
      const patch: SessionPatch = { researchReports };
      if (this.snapshot.legacyDraft) {
        patch.wizardState = JSON.parse(backup.wizard!);
        patch.currentDraft = JSON.parse(backup.draft!);
      }
      this.mutate(patch);
      this.emit({ legacyReports: 0, legacyDraft: false, legacyAvailable: false });
    } catch {
      this.emit({ message: 'The older local work could not be imported. Its backup remains on this device.' });
    }
  }

  legacyBackup(): string | null { return this.storage.getItem(LEGACY_KEY); }
  dismissLegacy() {
    this.storage.setItem(`${LEGACY_KEY}_dismissed`, '1');
    this.emit({ legacyAvailable: false });
  }
  pendingCopy(): string | null { return this.pending ? JSON.stringify(this.pending.state, null, 2) : null; }
}
