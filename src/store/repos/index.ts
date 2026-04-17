// =============================================================================
// DeepAnalyze - Repository Factory (PG-only)
// Creates and caches a singleton RepoSet backed by PostgreSQL.
// =============================================================================

import type { RepoSet } from './interfaces';
import { getPool } from '../pg';

import { PgVectorSearchRepo } from './vector-search';
import { PgFTSSearchRepo } from './fts-search';
import { PgAnchorRepo } from './anchor';
import { PgWikiPageRepo } from './wiki-page';
import { PgDocumentRepo } from './document';
import { PgEmbeddingRepo } from './embedding';

let cachedRepos: RepoSet | null = null;
let initPromise: Promise<RepoSet> | null = null;

/**
 * Get the singleton RepoSet. Initializes PG pool and creates all repos on first call.
 */
export async function getRepos(): Promise<RepoSet> {
  if (cachedRepos) return cachedRepos;
  if (!initPromise) {
    initPromise = (async () => {
      const pool = await getPool();
      cachedRepos = {
        vectorSearch: new PgVectorSearchRepo(pool),
        ftsSearch: new PgFTSSearchRepo(pool),
        anchor: new PgAnchorRepo(pool),
        wikiPage: new PgWikiPageRepo(pool),
        document: new PgDocumentRepo(pool),
        embedding: new PgEmbeddingRepo(pool),
        // Placeholder repos - will be replaced with real implementations in Phase 2
        session: null as any,
        message: null as any,
        knowledgeBase: null as any,
        wikiLink: null as any,
        settings: null as any,
        report: null as any,
        agentTeam: null as any,
        cronJob: null as any,
        plugin: null as any,
        skill: null as any,
        sessionMemory: null as any,
        agentTask: null as any,
      };
      return cachedRepos;
    })();
  }
  return initPromise;
}

export const createReposAsync = getRepos;

export function resetRepos(): void {
  cachedRepos = null;
  initPromise = null;
}

export type {
  RepoSet,
  AnchorDef,
  WikiPage,
  WikiPageCreate,
  Document,
  EmbeddingRow,
  EmbeddingCreate,
  VectorSearchResult,
  FTSSearchResult,
  VectorSearchRepo,
  FTSSearchRepo,
  AnchorRepo,
  WikiPageRepo,
  DocumentRepo,
  EmbeddingRepo,
  SessionRepo,
  MessageRepo,
  KnowledgeBaseRepo,
  WikiLinkRepo,
  SettingsRepo,
  ReportRepo,
  AgentTeamRepo,
  CronJobRepo,
  PluginRepo,
  SkillRepo,
  SessionMemoryRepo,
  AgentTaskRepo,
  Session,
  Message,
  KnowledgeBase,
  WikiLink,
  WikiPageSummary,
  SettingEntry,
  Report,
  ReportReference,
  ReportWithReferences,
  CreateReportData,
  AgentTeam,
  AgentTeamMember,
  AgentTeamWithMembers,
  CreateTeamData,
  UpdateTeamData,
  TeamMode,
  CronJob,
  NewCronJob,
  Plugin,
  NewPlugin,
  Skill,
  NewSkill,
  SessionMemory,
  AgentTask,
  NewAgentTask,
} from './interfaces';
