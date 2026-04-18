// =============================================================================
// Migration 006: Expand documents status CHECK constraint
// =============================================================================
// The processing queue uses "indexing" and "linking" status values that were
// missing from the original CHECK constraint.
// =============================================================================

import type { QueryConfig } from 'pg';

const migration: QueryConfig = {
  text: `
    ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
    ALTER TABLE documents ADD CONSTRAINT documents_status_check
      CHECK (status IN ('uploaded', 'parsing', 'compiling', 'indexing', 'linking', 'ready', 'error'));
  `,
};

export default migration;
