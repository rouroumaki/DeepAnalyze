// =============================================================================
// DeepAnalyze - Repository Factory
// Creates the appropriate RepoSet based on the configured backend.
// =============================================================================

import type { RepoSet } from './interfaces';
import { getPool } from '../pg';
import { PgVectorSearchRepo } from './vector-search';
import { PgFTSSearchRepo } from './fts-search';
import { PgAnchorRepo } from './anchor';
import { PgWikiPageRepo } from './wiki-page';
import { PgDocumentRepo } from './document';
import { PgEmbeddingRepo } from './embedding';

export function createRepos(): RepoSet {
  if (process.env.PG_HOST) {
    // Lazy initialization - creates pool on first call.
    // Use createReposAsync() for PG mode instead.
    throw new Error('Use createReposAsync() for PG mode');
  }
  throw new Error('SQLite repos not yet implemented');
}

export async function createReposAsync(): Promise<RepoSet> {
  if (process.env.PG_HOST) {
    const pool = await getPool();
    return {
      vectorSearch: new PgVectorSearchRepo(pool),
      ftsSearch: new PgFTSSearchRepo(pool),
      anchor: new PgAnchorRepo(pool),
      wikiPage: new PgWikiPageRepo(pool),
      document: new PgDocumentRepo(pool),
      embedding: new PgEmbeddingRepo(pool),
    };
  }
  throw new Error('SQLite repos not yet implemented');
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
} from './interfaces';
