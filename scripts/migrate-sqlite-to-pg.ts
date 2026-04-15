// =============================================================================
// DeepAnalyze - SQLite to PostgreSQL Data Migration Script
// =============================================================================
// Standalone migration script that reads data from an existing SQLite database
// and inserts it into a PostgreSQL database.
//
// Usage:
//   npx tsx scripts/migrate-sqlite-to-pg.ts [options]
//
// Options:
//   --sqlite-path     Path to SQLite database (default: data/deepanalyze.db)
//   --pg-host         PostgreSQL host (default: localhost)
//   --pg-port         PostgreSQL port (default: 5432)
//   --pg-database     PostgreSQL database name (default: deepanalyze)
//   --pg-user         PostgreSQL user (default: deepanalyze)
//   --pg-password     PostgreSQL password (default: deepanalyze_dev)
//   --dry-run         Verify counts only, do not write data
// =============================================================================

import Database from 'better-sqlite3';
import pg from 'pg';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface MigrationConfig {
  sqlitePath: string;
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): MigrationConfig {
  const config: MigrationConfig = {
    sqlitePath: 'data/deepanalyze.db',
    pgHost: 'localhost',
    pgPort: 5432,
    pgDatabase: 'deepanalyze',
    pgUser: 'deepanalyze',
    pgPassword: 'deepanalyze_dev',
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--sqlite-path':
        config.sqlitePath = argv[++i];
        break;
      case '--pg-host':
        config.pgHost = argv[++i];
        break;
      case '--pg-port':
        config.pgPort = parseInt(argv[++i], 10);
        break;
      case '--pg-database':
        config.pgDatabase = argv[++i];
        break;
      case '--pg-user':
        config.pgUser = argv[++i];
        break;
      case '--pg-password':
        config.pgPassword = argv[++i];
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Table migration definitions
// ---------------------------------------------------------------------------

/** Column conversion strategies */
type ConversionType =
  | 'text'       // pass through as-is
  | 'jsonb'      // parse JSON text -> re-stringify -> JSONB
  | 'boolean'    // SQLite INTEGER 0/1 -> PG BOOLEAN
  | 'vector';    // SQLite BLOB -> Float32Array -> pgvector string

interface ColumnDef {
  name: string;
  conversion: ConversionType;
  /** If true, treat NULL as empty string (for NOT NULL TEXT columns) */
  defaultEmpty?: boolean;
}

interface TableDef {
  name: string;
  pgName: string;
  columns: ColumnDef[];
  /** Column names that form the primary key (for conflict handling) */
  pkColumns: string[];
}

/**
 * Table migration order respects foreign key dependencies:
 * knowledge_bases has no FKs -> users has no FKs -> documents references
 * knowledge_bases -> etc.
 */
const TABLE_ORDER: TableDef[] = [
  {
    name: 'knowledge_bases',
    pgName: 'knowledge_bases',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'name', conversion: 'text' },
      { name: 'description', conversion: 'text' },
      { name: 'owner_id', conversion: 'text' },
      { name: 'visibility', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
      { name: 'updated_at', conversion: 'text' },
    ],
  },
  {
    name: 'users',
    pgName: 'users',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'username', conversion: 'text' },
      { name: 'password_hash', conversion: 'text' },
      { name: 'role', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
    ],
  },
  {
    name: 'documents',
    pgName: 'documents',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'kb_id', conversion: 'text' },
      { name: 'filename', conversion: 'text' },
      { name: 'file_path', conversion: 'text' },
      { name: 'file_hash', conversion: 'text' },
      { name: 'file_size', conversion: 'text' },
      { name: 'file_type', conversion: 'text', defaultEmpty: true },
      { name: 'status', conversion: 'text' },
      { name: 'metadata', conversion: 'jsonb' },
      { name: 'created_at', conversion: 'text' },
      { name: 'processing_step', conversion: 'text' },
      { name: 'processing_progress', conversion: 'text' },
      { name: 'processing_error', conversion: 'text' },
    ],
  },
  {
    name: 'tags',
    pgName: 'tags',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'name', conversion: 'text' },
      { name: 'color', conversion: 'text' },
    ],
  },
  {
    name: 'document_tags',
    pgName: 'document_tags',
    pkColumns: ['document_id', 'tag_id'],
    columns: [
      { name: 'document_id', conversion: 'text' },
      { name: 'tag_id', conversion: 'text' },
    ],
  },
  {
    name: 'wiki_pages',
    pgName: 'wiki_pages',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'kb_id', conversion: 'text' },
      { name: 'doc_id', conversion: 'text' },
      { name: 'page_type', conversion: 'text' },
      { name: 'title', conversion: 'text' },
      { name: 'file_path', conversion: 'text' },
      { name: 'content_hash', conversion: 'text' },
      { name: 'token_count', conversion: 'text' },
      { name: 'metadata', conversion: 'jsonb' },
      { name: 'created_at', conversion: 'text' },
      { name: 'updated_at', conversion: 'text' },
    ],
  },
  {
    name: 'wiki_links',
    pgName: 'wiki_links',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'source_page_id', conversion: 'text' },
      { name: 'target_page_id', conversion: 'text' },
      { name: 'link_type', conversion: 'text' },
      { name: 'entity_name', conversion: 'text' },
      { name: 'context', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
    ],
  },
  {
    name: 'embeddings',
    pgName: 'embeddings',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'page_id', conversion: 'text' },
      { name: 'model_name', conversion: 'text' },
      { name: 'dimension', conversion: 'text' },
      { name: 'vector', conversion: 'vector' },
      { name: 'text_chunk', conversion: 'text' },
      { name: 'chunk_index', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
    ],
  },
  {
    name: 'sessions',
    pgName: 'sessions',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'title', conversion: 'text' },
      { name: 'kb_scope', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
      { name: 'updated_at', conversion: 'text' },
    ],
  },
  {
    name: 'messages',
    pgName: 'messages',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'session_id', conversion: 'text' },
      { name: 'role', conversion: 'text' },
      { name: 'content', conversion: 'text' },
      { name: 'metadata', conversion: 'jsonb' },
      { name: 'created_at', conversion: 'text' },
    ],
  },
  {
    name: 'agent_tasks',
    pgName: 'agent_tasks',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'parent_task_id', conversion: 'text' },
      { name: 'session_id', conversion: 'text' },
      { name: 'agent_type', conversion: 'text' },
      { name: 'status', conversion: 'text' },
      { name: 'input', conversion: 'jsonb' },
      { name: 'output', conversion: 'jsonb' },
      { name: 'error', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
      { name: 'completed_at', conversion: 'text' },
    ],
  },
  {
    name: 'session_memory',
    pgName: 'session_memory',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'session_id', conversion: 'text' },
      { name: 'content', conversion: 'text' },
      { name: 'token_count', conversion: 'text' },
      { name: 'last_token_position', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
      { name: 'updated_at', conversion: 'text' },
    ],
  },
  {
    name: 'settings',
    pgName: 'settings',
    pkColumns: ['key'],
    columns: [
      { name: 'key', conversion: 'text' },
      { name: 'value', conversion: 'jsonb' },
      { name: 'updated_at', conversion: 'text' },
    ],
  },
  {
    name: 'cron_jobs',
    pgName: 'cron_jobs',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'name', conversion: 'text' },
      { name: 'schedule', conversion: 'text' },
      { name: 'message', conversion: 'text' },
      { name: 'enabled', conversion: 'boolean' },
      { name: 'channel', conversion: 'text' },
      { name: 'chat_id', conversion: 'text' },
      { name: 'deliver_response', conversion: 'boolean' },
      { name: 'last_run', conversion: 'text' },
      { name: 'next_run', conversion: 'text' },
      { name: 'last_status', conversion: 'text' },
      { name: 'last_error', conversion: 'text' },
      { name: 'run_count', conversion: 'text' },
      { name: 'error_count', conversion: 'text' },
      { name: 'created_at', conversion: 'text' },
      { name: 'updated_at', conversion: 'text' },
    ],
  },
  {
    name: 'plugins',
    pgName: 'plugins',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'name', conversion: 'text' },
      { name: 'version', conversion: 'text' },
      { name: 'enabled', conversion: 'boolean' },
      { name: 'config', conversion: 'jsonb' },
      { name: 'created_at', conversion: 'text' },
    ],
  },
  {
    name: 'skills',
    pgName: 'skills',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'name', conversion: 'text' },
      { name: 'plugin_id', conversion: 'text' },
      { name: 'description', conversion: 'text' },
      { name: 'config', conversion: 'jsonb' },
      { name: 'created_at', conversion: 'text' },
    ],
  },
  {
    name: 'search_cache',
    pgName: 'search_cache',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'query_hash', conversion: 'text' },
      { name: 'kb_ids', conversion: 'text' },
      { name: 'results', conversion: 'jsonb' },
      { name: 'created_at', conversion: 'text' },
      { name: 'expires_at', conversion: 'text' },
    ],
  },
  {
    name: 'audit_log',
    pgName: 'audit_log',
    pkColumns: ['id'],
    columns: [
      { name: 'id', conversion: 'text' },
      { name: 'user_id', conversion: 'text' },
      { name: 'action', conversion: 'text' },
      { name: 'resource', conversion: 'text' },
      { name: 'details', conversion: 'jsonb' },
      { name: 'created_at', conversion: 'text' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a SQLite BLOB (Float32Array buffer) to a pgvector-compatible string.
 * Format: [v1,v2,v3,...]
 */
function blobToVectorString(blob: Buffer): string {
  const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  const values: string[] = [];
  for (let i = 0; i < float32.length; i++) {
    values.push(float32[i].toString());
  }
  return `[${values.join(',')}]`;
}

/**
 * Safely parse and re-stringify JSON for JSONB columns.
 * Returns the validated JSON string, or null if input is null/empty.
 */
function toValidatedJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      console.warn(`  [WARN] Invalid JSON, storing as-is: ${(value as string).substring(0, 80)}...`);
      // Wrap as a JSON string literal so PG accepts it
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

/**
 * Convert SQLite INTEGER (0/1) to boolean.
 */
function toBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

// ---------------------------------------------------------------------------
// Migration report
// ---------------------------------------------------------------------------

interface TableReport {
  table: string;
  sqliteCount: number;
  pgCountBefore: number;
  pgCountAfter: number;
  migrated: number;
  skipped: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main migration logic
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = parseArgs(process.argv);
  const absoluteSqlitePath = resolve(config.sqlitePath);

  console.log('='.repeat(72));
  console.log('  DeepAnalyze - SQLite to PostgreSQL Migration');
  console.log('='.repeat(72));
  console.log(`  SQLite : ${absoluteSqlitePath}`);
  console.log(`  PG     : ${config.pgHost}:${config.pgPort}/${config.pgDatabase}`);
  console.log(`  User   : ${config.pgUser}`);
  if (config.dryRun) {
    console.log('  Mode   : DRY RUN (no data will be written)');
  }
  console.log('='.repeat(72));
  console.log();

  // -----------------------------------------------------------------------
  // 1. Open SQLite database
  // -----------------------------------------------------------------------
  if (!existsSync(absoluteSqlitePath)) {
    console.error(`ERROR: SQLite database not found at ${absoluteSqlitePath}`);
    process.exit(1);
  }

  const sqlite = new Database(absoluteSqlitePath, { readonly: true });
  console.log('[SQLite] Database opened successfully');

  // -----------------------------------------------------------------------
  // 2. Connect to PostgreSQL
  // -----------------------------------------------------------------------
  const pool = new pg.Pool({
    host: config.pgHost,
    port: config.pgPort,
    database: config.pgDatabase,
    user: config.pgUser,
    password: config.pgPassword,
  });

  try {
    const testResult = await pool.query('SELECT 1 AS ok');
    if (testResult.rows[0].ok !== 1) {
      throw new Error('PG connectivity check failed');
    }
    console.log('[PG] Connected successfully');
  } catch (err) {
    console.error('[PG] Connection failed:', (err as Error).message);
    sqlite.close();
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // 3. Discover which tables exist in SQLite
  // -----------------------------------------------------------------------
  const sqliteTableNames = new Set(
    (sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'")
      .all() as Array<{ name: string }>).map(r => r.name),
  );
  console.log(`[SQLite] Found tables: ${[...sqliteTableNames].join(', ')}`);
  console.log();

  // -----------------------------------------------------------------------
  // 4. Migrate tables in dependency order
  // -----------------------------------------------------------------------
  const report: TableReport[] = [];

  for (const tableDef of TABLE_ORDER) {
    const tableReport: TableReport = {
      table: tableDef.name,
      sqliteCount: 0,
      pgCountBefore: 0,
      pgCountAfter: 0,
      migrated: 0,
      skipped: false,
    };

    // Check if table exists in SQLite
    if (!sqliteTableNames.has(tableDef.name)) {
      tableReport.skipped = true;
      tableReport.sqliteCount = 0;
      console.log(`[${tableDef.name}] Skipped (table does not exist in SQLite)`);
      report.push(tableReport);
      continue;
    }

    // Count rows in SQLite
    const countRow = sqlite.prepare(`SELECT COUNT(*) AS cnt FROM "${tableDef.name}"`).get() as { cnt: number };
    tableReport.sqliteCount = countRow.cnt;

    if (tableReport.sqliteCount === 0) {
      tableReport.skipped = true;
      console.log(`[${tableDef.name}] Skipped (0 rows in SQLite)`);
      report.push(tableReport);
      continue;
    }

    // Count existing rows in PG
    try {
      const pgCountResult = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tableDef.pgName}"`);
      tableReport.pgCountBefore = parseInt(pgCountResult.rows[0].cnt, 10);
    } catch {
      tableReport.pgCountBefore = 0;
    }

    console.log(
      `[${tableDef.name}] Migrating ${tableReport.sqliteCount} rows (PG has ${tableReport.pgCountBefore} existing)`,
    );

    if (config.dryRun) {
      tableReport.skipped = true;
      tableReport.migrated = 0;
      console.log(`[${tableDef.name}] DRY RUN - skipping actual migration`);
      report.push(tableReport);
      continue;
    }

    // -------------------------------------------------------------------
    // Build INSERT statement
    // -------------------------------------------------------------------
    const colNames = tableDef.columns.map(c => c.name);
    const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ');
    const quotedCols = colNames.map(c => `"${c}"`).join(', ');

    // ON CONFLICT DO NOTHING for idempotent re-runs
    const pkCols = tableDef.pkColumns.map(c => `"${c}"`).join(', ');
    const insertSQL = `
      INSERT INTO "${tableDef.pgName}" (${quotedCols})
      VALUES (${placeholders})
      ON CONFLICT (${pkCols}) DO NOTHING
    `;

    // -------------------------------------------------------------------
    // Read all rows from SQLite
    // -------------------------------------------------------------------
    const rows = sqlite.prepare(`SELECT * FROM "${tableDef.name}"`).all() as Record<string, unknown>[];

    // -------------------------------------------------------------------
    // Insert rows into PG in batches
    // -------------------------------------------------------------------
    const BATCH_SIZE = 100;
    let migrated = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);

        for (const row of batch) {
          const values = tableDef.columns.map((col) => {
            const raw = row[col.name];

            switch (col.conversion) {
              case 'jsonb':
                return toValidatedJson(raw);
              case 'boolean':
                return toBoolean(raw);
              case 'vector':
                if (raw === null || raw === undefined) return null;
                if (Buffer.isBuffer(raw)) return blobToVectorString(raw);
                // If stored as something else, try to handle gracefully
                return raw;
              case 'text':
              default:
                if (raw === null || raw === undefined) {
                  if (col.defaultEmpty) return '';
                  return null;
                }
                return raw;
            }
          });

          try {
            const result = await client.query(insertSQL, values);
            if (result.rowCount !== null && result.rowCount > 0) {
              migrated++;
            }
          } catch (err) {
            console.error(
              `  [ERROR] Row failed for ${tableDef.name}: ${(err as Error).message}`,
            );
            // Log the problematic row ID for debugging
            const pkValues = tableDef.pkColumns.map(c => row[c]).join(', ');
            console.error(`  PK: (${pkValues})`);
          }
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      tableReport.error = (err as Error).message;
      console.error(`[${tableDef.name}] Batch failed, rolled back: ${(err as Error).message}`);
    } finally {
      client.release();
    }

    tableReport.migrated = migrated;

    // Count PG rows after migration
    try {
      const pgAfterResult = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tableDef.pgName}"`);
      tableReport.pgCountAfter = parseInt(pgAfterResult.rows[0].cnt, 10);
    } catch {
      tableReport.pgCountAfter = tableReport.pgCountBefore + migrated;
    }

    console.log(
      `[${tableDef.name}] Done: ${migrated} rows migrated (PG now has ${tableReport.pgCountAfter} rows)`,
    );

    report.push(tableReport);
  }

  // -----------------------------------------------------------------------
  // 5. Close connections
  // -----------------------------------------------------------------------
  sqlite.close();
  console.log('\n[SQLite] Database closed');

  await pool.end();
  console.log('[PG] Connection pool closed');

  // -----------------------------------------------------------------------
  // 6. Print migration report
  // -----------------------------------------------------------------------
  console.log('\n' + '='.repeat(72));
  console.log('  Migration Report');
  console.log('='.repeat(72));

  const pad = (s: string, len: number) => s.padEnd(len);
  const col1 = 22;
  const col2 = 10;
  const col3 = 10;
  const col4 = 10;
  const col5 = 10;
  const col6 = 12;

  console.log(
    pad('Table', col1) +
    pad('SQLite', col2) +
    pad('PG Before', col3) +
    pad('Migrated', col4) +
    pad('PG After', col5) +
    'Status',
  );
  console.log('-'.repeat(72));

  let totalSqlite = 0;
  let totalMigrated = 0;

  for (const r of report) {
    totalSqlite += r.sqliteCount;
    totalMigrated += r.migrated;

    const status = r.skipped
      ? 'SKIPPED'
      : r.error
        ? `ERROR: ${r.error.substring(0, 30)}`
        : 'OK';

    console.log(
      pad(r.table, col1) +
      pad(String(r.sqliteCount), col2) +
      pad(String(r.pgCountBefore), col3) +
      pad(String(r.migrated), col4) +
      pad(String(r.pgCountAfter), col5) +
      status,
    );
  }

  console.log('-'.repeat(72));
  console.log(
    pad('TOTAL', col1) +
    pad(String(totalSqlite), col2) +
    pad('', col3) +
    pad(String(totalMigrated), col4),
  );
  console.log('='.repeat(72));

  if (config.dryRun) {
    console.log('\nDRY RUN complete. No data was written to PostgreSQL.');
  } else {
    const allOk = report.every(r => r.skipped || !r.error);
    if (allOk) {
      console.log('\nMigration completed successfully.');
    } else {
      console.log('\nMigration completed with ERRORS. Review the report above.');
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('Migration failed with unhandled error:', err);
  process.exit(1);
});
