import { schema } from './schema.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REV = 2_147_483_646;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const parse = x => x == null ? null : JSON.parse(x);
const json = x => x == null ? null : JSON.stringify(x);
const first = (db, sql, ...args) => db.exec(sql, ...args).toArray()[0] ?? null;
const now = () => new Date().toISOString();

export function initialize(db) {
  for (const statement of schema) db.exec(statement);
  db.exec(`INSERT OR IGNORE INTO shared_news_selection(id,session_id,updated_at) VALUES('default',?,?)`, crypto.randomUUID(), now());
}

function row(db) { return first(db, `SELECT * FROM shared_news_selection WHERE id='default'`); }
function state(db) {
  const w = row(db);
  if (!w) throw new Error('missing_workspace');
  const d = w.draft_id ? first(db, `SELECT payload,revision FROM studio_drafts WHERE id=?`, w.draft_id) : null;
  if (w.draft_id && !d) throw new Error('missing_active_draft');
  return {
    ...w,
    curated_stories: parse(w.curated_stories), selected_ids: parse(w.selected_ids),
    research_reports: parse(w.research_reports), wizard_state: parse(w.wizard_state),
    draft_choices: parse(w.draft_choices),
    current_draft: d ? { ...parse(d.payload), studioServerRevision: d.revision } : parse(w.current_draft),
  };
}

function version(db, source, w, snapshot, draftId = w.draft_id) {
  const id = crypto.randomUUID();
  db.exec(`INSERT INTO newsletter_versions(id,source,session_id,draft_id,snapshot,created_at) VALUES(?,?,?,?,?,?)`, id, source, w.session_id, draftId, json(snapshot), now());
  return id;
}

function prune(db, w) {
  const protectedIds = new Set(parse(w.draft_choices).map(c => c.id));
  const cutoff = new Date(Date.now() - DAY_MS).toISOString();
  const old = db.exec(`SELECT id FROM newsletter_versions WHERE created_at < ?`, cutoff).toArray();
  for (const v of old) if (!protectedIds.has(v.id)) db.exec(`DELETE FROM newsletter_versions WHERE id=?`, v.id);
}

// Returns the first unprotected version's expiry. Protected recovery choices
// have no deadline until the choice is resolved.
export function nextHistoryExpiry(storage) {
  const db = storage.sql;
  const earliest = first(db, `SELECT v.created_at FROM newsletter_versions AS v
    WHERE NOT EXISTS (
      SELECT 1 FROM shared_news_selection AS w, json_each(w.draft_choices) AS choice
      WHERE w.id='default' AND json_extract(choice.value,'$.id')=v.id
    ) ORDER BY v.created_at ASC LIMIT 1`);
  if (!earliest) return null;
  const created = Date.parse(earliest.created_at);
  if (!Number.isFinite(created)) throw new Error('invalid_version_timestamp');
  return created + DAY_MS;
}

export function pruneExpiredHistory(storage) {
  return storage.transactionSync(() => prune(storage.sql, row(storage.sql)));
}

function validRevision(n) { return Number.isSafeInteger(n) && n >= 0 && n <= MAX_REV; }
function validDraft(body) { return object(body) && UUID.test(body.studioDraftId) && Array.isArray(body.stories); }
function validContent(c) {
  return object(c) && typeof c.sessionId === 'string' && c.sessionId.trim() && c.sessionId.length <= 128 &&
    Array.isArray(c.curatedStories) && Array.isArray(c.selectedIds) && c.selectedIds.length <= 30 &&
    Array.isArray(c.researchReports) && c.researchReports.length <= 30 &&
    (c.wizardState == null || object(c.wizardState)) &&
    (c.currentDraft == null || validDraft(c.currentDraft));
}

function normalizeWizard(meta) {
  if (!object(meta) || !object(meta.completed)) return meta;
  const done = meta.completed;
  const reports = Array.isArray(meta.selectedReports) ? meta.selectedReports : [];
  const stories = Array.isArray(done.stories) ? done.stories : [];
  const flags = { hook: done.hook != null, intro: done.intro != null, toc: done.toc != null, summary: done.summary != null,
    stories: stories.flatMap((s, i) => s == null ? [] : [s.sourceStoryId ?? reports[i]?.story?.id].filter(Boolean)) };
  const { completed, ...rest } = meta;
  return { ...rest, completion: flags };
}

function save(db, input) {
  const { expectedRevision, resolveVersion = null } = input;
  let { content } = input;
  if (!validRevision(expectedRevision) || !validContent(content) || (resolveVersion != null && !UUID.test(resolveVersion))) throw new Error('invalid_payload');
  const w = row(db);
  if (w.revision !== expectedRevision) return { conflict: true, state: state(db) };
  const choices = parse(w.draft_choices);
  let body = content.currentDraft;
  let meta = normalizeWizard(content.wizardState);
  if (choices.length && (!resolveVersion || !choices.some(c => c.id === resolveVersion))) return { choiceRequired: true, state: state(db) };
  if (resolveVersion) {
    const selected = first(db, `SELECT snapshot FROM newsletter_versions WHERE id=?`, resolveVersion);
    if (!selected) throw new Error('missing_recovery_version');
    const s = parse(selected.snapshot);
    if (choices.length) {
      body = s.current_draft;
      if (!validDraft(body)) throw new Error('invalid_recovery_version');
      const flags = { hook: true, intro: true, toc: true, summary: true,
        stories: (body.stories ?? []).map(x => x.sourceStoryId).filter(Boolean) };
      meta = s.wizard_state ?? { ...(parse(w.wizard_state) ?? {}), completion: flags };
    } else {
      if (!s.session_id) throw new Error('invalid_recovery_version');
      content = { ...content, sessionId: s.session_id, curatedStories: s.curated_stories,
        selectedIds: s.selected_ids, researchReports: s.research_reports };
      body = s.current_draft;
      meta = s.wizard_state;
      if (!validContent({ ...content, currentDraft: body, wizardState: meta })) throw new Error('invalid_recovery_version');
    }
  }
  const d = body ? first(db, `SELECT * FROM studio_drafts WHERE id=?`, body.studioDraftId) : null;
  if (body && !resolveVersion && d && body.studioServerRevision !== d.revision) return { conflict: true, state: state(db) };
  // The archive and all subsequent writes are in the caller's transactionSync.
  version(db, body ? 'workspace-save' : w.session_id !== content.sessionId ? 'new-newsletter' : 'workspace-save', w, state(db));
  let draftId = null;
  if (body) {
    draftId = body.studioDraftId;
    const { studioServerRevision, ...payload } = body;
    db.exec(`INSERT INTO studio_drafts(id,payload,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at`, draftId, json(payload), (d?.revision ?? 0) + 1, now());
  }
  db.exec(`UPDATE shared_news_selection SET session_id=?,revision=revision+1,curated_stories=?,selected_ids=?,research_reports=?,wizard_state=?,current_draft=NULL,draft_id=?,draft_choices='[]',updated_at=? WHERE id='default'`, content.sessionId, json(content.curatedStories), json(content.selectedIds), json(content.researchReports), json(meta), draftId, now());
  prune(db, row(db));
  return { state: state(db) };
}

function studioSave(db, { body, expectedRevision }) {
  if (!validDraft(body) || (expectedRevision !== null && !validRevision(expectedRevision))) throw new Error('invalid_payload');
  const w = row(db);
  if (parse(w.draft_choices).length) return { choiceRequired: true };
  const d = first(db, `SELECT * FROM studio_drafts WHERE id=?`, body.studioDraftId);
  if ((d?.revision ?? null) !== expectedRevision) return { conflict: true };
  version(db, 'studio-save', w, { current_draft: d ? parse(d.payload) : null, wizard_state: parse(w.wizard_state) }, body.studioDraftId);
  const { studioServerRevision, ...payload } = body;
  const updated = now();
  db.exec(`INSERT INTO studio_drafts(id,payload,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at`, body.studioDraftId, json(payload), (d?.revision ?? 0) + 1, updated);
  if (w.draft_id === body.studioDraftId) db.exec(`UPDATE shared_news_selection SET revision=revision+1,updated_at=? WHERE id='default'`, updated);
  prune(db, row(db));
  const saved = first(db, `SELECT * FROM studio_drafts WHERE id=?`, body.studioDraftId);
  return { ...saved, payload: parse(saved.payload) };
}

function sqlCall(db, command) {
  if (!object(command) || typeof command.sql !== 'string' || !Array.isArray(command.params) || command.sql.length > 20000 ||
      command.params.length > 100 || command.params.some(x => !(x === null || typeof x === 'string' || typeof x === 'number' && Number.isFinite(x))) ||
      /;\s*\S/.test(command.sql) || /\b(?:attach|detach|pragma|vacuum|begin|commit|rollback|savepoint|release)\b/i.test(command.sql)) throw new Error('invalid_query');
  const cursor = db.exec(command.sql, ...command.params);
  const rows = cursor.toArray();
  return { rows, changes: cursor.rowsWritten };
}

export function execute(storage, request) {
  const db = storage.sql;
  if (!object(request) || typeof request.op !== 'string') throw new Error('invalid_payload');
  if (request.op === 'health') return { ready: !!row(db) };
  if (request.op === 'newsletter_state') return state(db);
  if (request.op === 'query') return storage.transactionSync(() => sqlCall(db, request));
  if (request.op === 'batch') {
    if (!Array.isArray(request.statements) || request.statements.length > 100) throw new Error('invalid_query');
    return storage.transactionSync(() => request.statements.map(c => sqlCall(db, c)));
  }
  if (request.op === 'newsletter_save') return storage.transactionSync(() => save(db, request));
  if (request.op === 'newsletter_studio_save') return storage.transactionSync(() => studioSave(db, request));
  if (request.op === 'activate_style') return storage.transactionSync(() => {
    if (typeof request.packId !== 'string' || !UUID.test(request.packId)) throw new Error('invalid_payload');
    if (!first(db, `SELECT id FROM studio_style_packs WHERE id=?`, request.packId)) throw new Error('unknown_style_pack');
    db.exec(`UPDATE studio_style_packs SET active=0 WHERE active=1`);
    db.exec(`UPDATE studio_style_packs SET active=1 WHERE id=?`, request.packId);
    return { activePackId: request.packId };
  });
  throw new Error('unknown_operation');
}
