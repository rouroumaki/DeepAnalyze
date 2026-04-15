// =============================================================================
// DeepAnalyze - Repository Factory
// Creates the appropriate RepoSet based on the configured backend.
// =============================================================================

import type { RepoSet } from './interfaces';

export function createRepos(): RepoSet {
  if (process.env.PG_HOST) {
    throw new Error('PG repos not yet implemented');
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
