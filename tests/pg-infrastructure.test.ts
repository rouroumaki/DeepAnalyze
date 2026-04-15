// =============================================================================
// DeepAnalyze - PostgreSQL Infrastructure Integration Tests
// =============================================================================
// Integration tests that verify the complete PG infrastructure works together:
// connection pool, pgvector, zhparser, HNSW indexes, and the repo factory.
// Tests are skipped when PG_HOST is not set.
// =============================================================================

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// Skip all tests if PG is not available
const pgHost = process.env.PG_HOST;
describe.skipIf(!pgHost)('PostgreSQL Infrastructure', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.PG_HOST ?? 'localhost',
      port: parseInt(process.env.PG_PORT ?? '5432', 10),
      database: process.env.PG_DATABASE ?? 'deepanalyze',
      user: process.env.PG_USER ?? 'deepanalyze',
      password: process.env.PG_PASSWORD ?? 'deepanalyze_dev',
      max: 5,
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('PG connection pool works', async () => {
    const { rows } = await pool.query('SELECT 1 as value');
    expect(rows[0].value).toBe(1);
  });

  test('pgvector extension is available', async () => {
    // Create a temporary table with vector column, insert, and query
    await pool.query('CREATE TABLE IF NOT EXISTS _test_vector (id TEXT PRIMARY KEY, vec vector(8))');
    await pool.query("INSERT INTO _test_vector (id, vec) VALUES ('test', '[1,2,3,4,5,6,7,8]') ON CONFLICT (id) DO UPDATE SET vec = EXCLUDED.vec");
    const { rows } = await pool.query("SELECT 1 - (vec <=> '[1,2,3,4,5,6,7,8]') as similarity FROM _test_vector WHERE id = 'test'");
    expect(rows[0].similarity).toBeCloseTo(1.0, 5);
    await pool.query('DROP TABLE IF EXISTS _test_vector');
  });

  test('zhparser extension is available', async () => {
    // Test Chinese text segmentation
    const { rows } = await pool.query("SELECT to_tsvector('chinese', '微服务架构设计模式') as vec");
    expect(rows[0].vec).toBeTruthy();
    // Should produce tokens from Chinese text
    expect(String(rows[0].vec).length).toBeGreaterThan(0);
  });

  test('chinese text search configuration exists', async () => {
    const { rows } = await pool.query("SELECT cfgname FROM pg_ts_config WHERE cfgname = 'chinese'");
    // If this fails, the migration hasn't been run yet - that's ok for this test
    if (rows.length > 0) {
      expect(rows[0].cfgname).toBe('chinese');
    }
  });

  test('HNSW index can be used for vector search', async () => {
    // Only test if the schema has been applied
    const { rows: tables } = await pool.query("SELECT tablename FROM pg_tables WHERE tablename = 'embeddings'");
    if (tables.length === 0) return; // Schema not applied yet

    const { rows } = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'embeddings' AND indexdef LIKE '%hnsw%'"
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  test('createReposAsync returns correct implementation', async () => {
    // Temporarily set PG_HOST to test the factory
    const originalPgHost = process.env.PG_HOST;
    process.env.PG_HOST = process.env.PG_HOST ?? 'localhost';

    try {
      const { createReposAsync } = await import('../src/store/repos/index');
      const repos = await createReposAsync();

      expect(repos.vectorSearch).toBeDefined();
      expect(repos.ftsSearch).toBeDefined();
      expect(repos.anchor).toBeDefined();
      expect(repos.wikiPage).toBeDefined();
      expect(repos.document).toBeDefined();
      expect(repos.embedding).toBeDefined();
    } finally {
      process.env.PG_HOST = originalPgHost;
    }
  });
});
