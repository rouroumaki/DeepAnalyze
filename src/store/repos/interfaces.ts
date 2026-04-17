// =============================================================================
// DeepAnalyze - Repository Interfaces & Domain Types
// Defines all repository interfaces for the data access layer.
// PostgreSQL (pgvector + zhparser) is the sole backend.
// =============================================================================

// ---------------------------------------------------------------------------
// Domain Types — Existing (anchor, wiki, document, embedding, search)
// ---------------------------------------------------------------------------

/** Structural element anchor within a document. */
export interface AnchorDef {
  id: string;
  doc_id: string;
  kb_id: string;
  element_type: string;
  element_index: number;
  section_path?: string;
  section_title?: string;
  page_number?: number;
  raw_json_path?: string;
  structure_page_id?: string;
  content_preview?: string;
  content_hash?: string;
  metadata?: Record<string, unknown>;
}

/** Wiki page record with full content. */
export interface WikiPage {
  id: string;
  kb_id: string;
  doc_id: string | null;
  page_type: string;
  title: string;
  file_path: string;
  content: string;
  content_hash: string;
  token_count: number;
  metadata: Record<string, unknown> | null;
  fts_vector?: unknown;
  created_at: string;
  updated_at: string;
}

/** Data required to create a new wiki page. */
export interface WikiPageCreate {
  kb_id: string;
  doc_id?: string;
  page_type: string;
  title: string;
  content?: string;
  file_path?: string;
  content_hash?: string;
  token_count?: number;
  metadata?: Record<string, unknown>;
}

/** Document record. */
export interface Document {
  id: string;
  kb_id: string;
  filename: string;
  file_path: string;
  file_hash: string;
  file_size: number;
  file_type: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  processing_step?: string;
  processing_progress?: number;
  processing_error?: string;
}

/** Embedding row with raw vector data. */
export interface EmbeddingRow {
  id: string;
  page_id: string;
  model_name: string;
  dimension: number;
  vector: Float32Array;
  text_chunk: string;
  chunk_index: number;
  created_at: string;
}

/** Data required to create or update an embedding. */
export interface EmbeddingCreate {
  id: string;
  page_id: string;
  model_name: string;
  dimension: number;
  vector: Float32Array;
  text_chunk?: string;
  chunk_index?: number;
}

/** Result row from vector similarity search. */
export interface VectorSearchResult {
  id: string;
  page_id: string;
  text_chunk: string;
  model_name: string;
  similarity: number;
  kb_id: string;
  doc_id: string | null;
  page_type: string;
  title: string;
}

/** Result row from full-text search. */
export interface FTSSearchResult {
  id: string;
  kb_id: string;
  doc_id: string | null;
  page_type: string;
  title: string;
  file_path: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Domain Types — Session & Chat
// ---------------------------------------------------------------------------

/** Session record. */
export interface Session {
  id: string;
  title: string | null;
  kbScope: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Chat message. */
export interface Message {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  metadata: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Domain Types — Knowledge Base
// ---------------------------------------------------------------------------

/** Knowledge base. */
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Domain Types — Wiki Links
// ---------------------------------------------------------------------------

/** Wiki link between pages. */
export interface WikiLink {
  id: string;
  sourcePageId: string;
  targetPageId: string;
  linkType: string;
  entityName: string | null;
  context: string | null;
  createdAt: string;
}

/** Wiki page lightweight result for link queries. */
export interface WikiPageSummary {
  id: string;
  kbId: string;
  docId: string | null;
  pageType: string;
  title: string;
  filePath: string;
}

// ---------------------------------------------------------------------------
// Domain Types — Reports
// ---------------------------------------------------------------------------

/** Report record. */
export interface Report {
  id: string;
  sessionId: string;
  messageId: string;
  title: string;
  cleanContent: string;
  rawContent: string;
  entities: string[];
  createdAt: string;
}

/** Report reference to a source. */
export interface ReportReference {
  id: number;
  reportId: string;
  refIndex: number;
  docId: string;
  pageId: string;
  title: string;
  level: 'L0' | 'L1' | 'L2';
  snippet: string;
  highlight: string;
}

/** Report with its references. */
export interface ReportWithReferences extends Report {
  references: ReportReference[];
}

/** Data to create a report. */
export interface CreateReportData {
  sessionId: string;
  messageId: string;
  title: string;
  cleanContent: string;
  rawContent: string;
  entities?: string[];
  references?: Omit<ReportReference, 'id' | 'reportId'>[];
}

// ---------------------------------------------------------------------------
// Domain Types — Agent Teams
// ---------------------------------------------------------------------------

/** Agent team mode. */
export type TeamMode = 'pipeline' | 'graph' | 'council' | 'parallel';

/** Agent team record. */
export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  mode: TeamMode;
  isActive: boolean;
  crossReview: boolean;
  enableSkills: boolean;
  modelConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Agent team member. */
export interface AgentTeamMember {
  id: string;
  teamId: string;
  role: string;
  systemPrompt?: string;
  task: string;
  perspective?: string;
  dependsOn: string[];
  condition?: Record<string, unknown>;
  tools: string[];
  sortOrder: number;
}

/** Agent team with members. */
export interface AgentTeamWithMembers extends AgentTeam {
  members: AgentTeamMember[];
}

/** Data to create a team. */
export interface CreateTeamData {
  name: string;
  description: string;
  mode: TeamMode;
  isActive?: boolean;
  crossReview?: boolean;
  enableSkills?: boolean;
  modelConfig?: Record<string, unknown>;
  members: Omit<AgentTeamMember, 'id' | 'teamId'>[];
}

/** Data to update a team. */
export interface UpdateTeamData {
  name?: string;
  description?: string;
  mode?: TeamMode;
  isActive?: boolean;
  crossReview?: boolean;
  enableSkills?: boolean;
  modelConfig?: Record<string, unknown>;
  members?: Omit<AgentTeamMember, 'id' | 'teamId'>[];
}

// ---------------------------------------------------------------------------
// Domain Types — Cron Jobs
// ---------------------------------------------------------------------------

/** Cron job record. */
export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  message: string;
  enabled: boolean;
  channel?: string;
  chatId?: string;
  deliverResponse?: boolean;
  lastRun?: string;
  nextRun?: string;
  lastStatus?: string;
  lastError?: string;
  runCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Data to create a cron job. */
export interface NewCronJob {
  name: string;
  schedule: string;
  message: string;
  enabled?: boolean;
  channel?: string;
  chatId?: string;
  deliverResponse?: boolean;
  nextRun?: string;
}

// ---------------------------------------------------------------------------
// Domain Types — Plugins & Skills
// ---------------------------------------------------------------------------

/** Plugin record. */
export interface Plugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
}

/** Data to upsert a plugin. */
export interface NewPlugin {
  id: string;
  name: string;
  version?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** Skill record. */
export interface Skill {
  id: string;
  name: string;
  pluginId: string;
  description?: string;
  config: Record<string, unknown> | null;
  createdAt: string;
}

/** Data to create a skill. */
export interface NewSkill {
  id: string;
  name: string;
  pluginId: string;
  description?: string;
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Domain Types — Session Memory
// ---------------------------------------------------------------------------

/** Session memory record. */
export interface SessionMemory {
  id: string;
  sessionId: string;
  content: string;
  tokenCount: number;
  lastTokenPosition: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Domain Types — Agent Tasks
// ---------------------------------------------------------------------------

/** Agent task record. */
export interface AgentTask {
  id: string;
  parentTaskId: string | null;
  sessionId: string | null;
  agentType: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Data to create an agent task. */
export interface NewAgentTask {
  parentTaskId?: string;
  sessionId?: string;
  agentType: string;
  input?: unknown;
}

// ---------------------------------------------------------------------------
// Domain Types — Settings
// ---------------------------------------------------------------------------

/** Settings key-value entry. */
export interface SettingEntry {
  key: string;
  value: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Repository Options
// ---------------------------------------------------------------------------

/** Options for vector similarity search. */
export interface VectorSearchOptions {
  topK: number;
  minScore?: number;
  pageTypes?: string[];
  modelName?: string;
}

/** Options for full-text search. */
export interface FTSSearchOptions {
  topK: number;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Search & Knowledge
// ---------------------------------------------------------------------------

/** Vector similarity search via pgvector. */
export interface VectorSearchRepo {
  upsertEmbedding(row: EmbeddingCreate): Promise<void>;
  searchByVector(queryVector: Float32Array, kbIds: string[], options: VectorSearchOptions): Promise<VectorSearchResult[]>;
  deleteByPageId(pageId: string): Promise<void>;
  deleteByDocId(docId: string): Promise<void>;
}

/** Full-text search via zhparser/GIN index. */
export interface FTSSearchRepo {
  upsertFTSEntry(pageId: string, title: string, content: string): Promise<void>;
  searchByText(query: string, kbIds: string[], options: FTSSearchOptions): Promise<FTSSearchResult[]>;
  deleteByPageId(pageId: string): Promise<void>;
}

/** Structural element anchors for documents. */
export interface AnchorRepo {
  batchInsert(anchors: AnchorDef[]): Promise<void>;
  getByDocId(docId: string): Promise<AnchorDef[]>;
  getById(id: string): Promise<AnchorDef | undefined>;
  getByStructurePageId(pageId: string): Promise<AnchorDef[]>;
  updateStructurePageId(anchorIds: string[], pageId: string): Promise<void>;
  deleteByDocId(docId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Wiki & Documents
// ---------------------------------------------------------------------------

/** Wiki page CRUD. */
export interface WikiPageRepo {
  create(data: WikiPageCreate): Promise<WikiPage>;
  getById(id: string): Promise<WikiPage | undefined>;
  getByDocAndType(docId: string, pageType: string): Promise<WikiPage | undefined>;
  getManyByDocAndType(docId: string, pageType: string): Promise<WikiPage[]>;
  getByKbAndType(kbId: string, pageType?: string): Promise<WikiPage[]>;
  findByTitle(kbId: string, title: string, pageType: string): Promise<WikiPage | undefined>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  updateContent(id: string, content: string, contentHash: string, tokenCount: number): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByDocId(docId: string): Promise<void>;
}

/** Document CRUD with processing status tracking. */
export interface DocumentRepo {
  getById(id: string): Promise<Document | undefined>;
  getByKbId(kbId: string): Promise<Document[]>;
  create(doc: Omit<Document, 'id' | 'created_at'>): Promise<Document>;
  updateStatus(id: string, status: string): Promise<void>;
  updateProcessing(id: string, step: string, progress: number, error?: string): Promise<void>;
  updateStatusWithProcessing(id: string, status: string, step: string, progress: number, error?: string): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByKbId(kbId: string): Promise<void>;
}

/** Embedding management with deduplication by page+model+chunk. */
export interface EmbeddingRepo {
  getOrNone(pageId: string, modelName: string, chunkIndex: number): Promise<EmbeddingRow | undefined>;
  upsert(row: EmbeddingCreate): Promise<void>;
  deleteByPageId(pageId: string): Promise<void>;
  markAllStale(): Promise<void>;
  getStaleCount(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Session & Chat
// ---------------------------------------------------------------------------

/** Session CRUD. */
export interface SessionRepo {
  create(title?: string, kbScope?: Record<string, unknown>): Promise<Session>;
  list(): Promise<Session[]>;
  get(id: string): Promise<Session | undefined>;
  delete(id: string): Promise<boolean>;
  updateTimestamp(id: string): Promise<void>;
}

/** Message CRUD within sessions. */
export interface MessageRepo {
  create(sessionId: string, role: string, content: string | null, metadata?: Record<string, unknown>): Promise<Message>;
  list(sessionId: string): Promise<Message[]>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Knowledge Base
// ---------------------------------------------------------------------------

/** Knowledge base CRUD. */
export interface KnowledgeBaseRepo {
  create(name: string, ownerId: string, description?: string, visibility?: string): Promise<KnowledgeBase>;
  get(id: string): Promise<KnowledgeBase | undefined>;
  list(): Promise<KnowledgeBase[]>;
  update(id: string, fields: { name?: string; description?: string; visibility?: string }): Promise<KnowledgeBase | undefined>;
  delete(id: string): Promise<boolean>;
  getAnyId(): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Wiki Links
// ---------------------------------------------------------------------------

/** Wiki link management for inter-page relationships. */
export interface WikiLinkRepo {
  create(sourcePageId: string, targetPageId: string, linkType: string, entityName?: string, context?: string): Promise<WikiLink>;
  getOutgoing(pageId: string): Promise<WikiLink[]>;
  getIncoming(pageId: string): Promise<WikiLink[]>;
  deleteByPageId(pageId: string): Promise<void>;
  findExisting(sourcePageId: string, targetPageId: string, linkType: string, entityName?: string): Promise<WikiLink | undefined>;
  findEntityLinksByKb(kbId: string): Promise<Array<{ sourcePageId: string; entityName: string }>>;
  findRelatedByEntity(kbId: string, entityName: string): Promise<WikiPageSummary[]>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Settings
// ---------------------------------------------------------------------------

/** Key-value settings store backed by JSONB. */
export interface SettingsRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  getProviderSettings(): Promise<any>;
  saveProviderSettings(settings: any): Promise<void>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Reports
// ---------------------------------------------------------------------------

/** Report CRUD with references. */
export interface ReportRepo {
  create(data: CreateReportData): Promise<ReportWithReferences>;
  get(id: string): Promise<ReportWithReferences | undefined>;
  getByMessageId(messageId: string): Promise<ReportWithReferences | undefined>;
  list(limit?: number, offset?: number): Promise<Report[]>;
  listBySession(sessionId: string): Promise<Report[]>;
  delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Agent Teams
// ---------------------------------------------------------------------------

/** Agent team CRUD with members. */
export interface AgentTeamRepo {
  create(data: CreateTeamData): Promise<AgentTeamWithMembers>;
  get(id: string): Promise<AgentTeamWithMembers | undefined>;
  getByName(name: string): Promise<AgentTeamWithMembers | undefined>;
  list(): Promise<AgentTeam[]>;
  update(id: string, data: UpdateTeamData): Promise<AgentTeamWithMembers | undefined>;
  delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Cron Jobs
// ---------------------------------------------------------------------------

/** Scheduled job management. */
export interface CronJobRepo {
  create(job: NewCronJob): Promise<CronJob>;
  get(id: string): Promise<CronJob | undefined>;
  list(): Promise<CronJob[]>;
  update(id: string, fields: Partial<CronJob>): Promise<void>;
  delete(id: string): Promise<boolean>;
  getDueJobs(now: Date): Promise<CronJob[]>;
  markCompleted(id: string, nextRun: Date): Promise<void>;
  markFailed(id: string, error: string, nextRun: Date): Promise<void>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Plugins & Skills
// ---------------------------------------------------------------------------

/** Plugin registry management. */
export interface PluginRepo {
  upsert(plugin: NewPlugin): Promise<void>;
  get(id: string): Promise<Plugin | undefined>;
  list(): Promise<Plugin[]>;
  updateEnabled(id: string, enabled: boolean): Promise<void>;
  updateConfig(id: string, config: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** Skill definitions within plugins. */
export interface SkillRepo {
  create(skill: NewSkill): Promise<Skill>;
  get(id: string): Promise<Skill | undefined>;
  list(pluginId?: string): Promise<Skill[]>;
  delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Session Memory
// ---------------------------------------------------------------------------

/** Conversation memory persistence. */
export interface SessionMemoryRepo {
  load(sessionId: string): Promise<SessionMemory | undefined>;
  save(sessionId: string, content: string, tokenCount: number, lastTokenPosition: number): Promise<void>;
  listRecent(limit: number): Promise<Array<{ sessionId: string; content: string }>>;
}

// ---------------------------------------------------------------------------
// Repository Interfaces — Agent Tasks
// ---------------------------------------------------------------------------

/** Agent task execution tracking. */
export interface AgentTaskRepo {
  create(data: NewAgentTask): Promise<AgentTask>;
  updateStatus(id: string, status: string, output?: unknown, error?: string): Promise<void>;
  get(id: string): Promise<AgentTask | undefined>;
  listBySession(sessionId: string): Promise<AgentTask[]>;
}

// ---------------------------------------------------------------------------
// RepoSet - Bundles all 17 repositories behind a single interface
// ---------------------------------------------------------------------------

/** A complete set of repository instances for the application. */
export interface RepoSet {
  vectorSearch: VectorSearchRepo;
  ftsSearch: FTSSearchRepo;
  anchor: AnchorRepo;
  wikiPage: WikiPageRepo;
  document: DocumentRepo;
  embedding: EmbeddingRepo;
  session: SessionRepo;
  message: MessageRepo;
  knowledgeBase: KnowledgeBaseRepo;
  wikiLink: WikiLinkRepo;
  settings: SettingsRepo;
  report: ReportRepo;
  agentTeam: AgentTeamRepo;
  cronJob: CronJobRepo;
  plugin: PluginRepo;
  skill: SkillRepo;
  sessionMemory: SessionMemoryRepo;
  agentTask: AgentTaskRepo;
}
