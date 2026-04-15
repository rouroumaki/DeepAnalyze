// =============================================================================
// DeepAnalyze - PgWikiPageRepo
// PostgreSQL implementation of WikiPageRepo.
// CRUD operations for wiki pages with JSONB metadata support.
// =============================================================================

import pg from 'pg';
import type { WikiPageRepo, WikiPage, WikiPageCreate } from './interfaces';

export class PgWikiPageRepo implements WikiPageRepo {
  constructor(private pool: pg.Pool) {}

  async create(data: WikiPageCreate): Promise<WikiPage> {
    const { rows } = await this.pool.query(
      `INSERT INTO wiki_pages (kb_id, doc_id, page_type, title, file_path, content, content_hash, token_count, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.kb_id,
        data.doc_id ?? null,
        data.page_type,
        data.title,
        data.file_path ?? '',
        data.content ?? '',
        data.content_hash ?? '',
        data.token_count ?? 0,
        JSON.stringify(data.metadata ?? {}),
      ],
    );
    return this.mapRow(rows[0]);
  }

  async getById(id: string): Promise<WikiPage | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM wiki_pages WHERE id = $1',
      [id],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getByDocAndType(docId: string, pageType: string): Promise<WikiPage | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM wiki_pages WHERE doc_id = $1 AND page_type = $2 LIMIT 1',
      [docId, pageType],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getManyByDocAndType(docId: string, pageType: string): Promise<WikiPage[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM wiki_pages WHERE doc_id = $1 AND page_type = $2 ORDER BY created_at',
      [docId, pageType],
    );
    return rows.map((r: any) => this.mapRow(r));
  }

  async getByKbAndType(kbId: string, pageType?: string): Promise<WikiPage[]> {
    if (pageType) {
      const { rows } = await this.pool.query(
        'SELECT * FROM wiki_pages WHERE kb_id = $1 AND page_type = $2',
        [kbId, pageType],
      );
      return rows.map((r: any) => this.mapRow(r));
    }
    const { rows } = await this.pool.query(
      'SELECT * FROM wiki_pages WHERE kb_id = $1',
      [kbId],
    );
    return rows.map((r: any) => this.mapRow(r));
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      'UPDATE wiki_pages SET metadata = $1, updated_at = now() WHERE id = $2',
      [JSON.stringify(metadata), id],
    );
  }

  async updateContent(id: string, content: string, contentHash: string, tokenCount: number): Promise<void> {
    await this.pool.query(
      'UPDATE wiki_pages SET content = $1, content_hash = $2, token_count = $3, updated_at = now() WHERE id = $4',
      [content, contentHash, tokenCount, id],
    );
  }

  async deleteById(id: string): Promise<void> {
    await this.pool.query('DELETE FROM wiki_pages WHERE id = $1', [id]);
  }

  async deleteByDocId(docId: string): Promise<void> {
    await this.pool.query('DELETE FROM wiki_pages WHERE doc_id = $1', [docId]);
  }

  private mapRow(row: any): WikiPage {
    return {
      ...row,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    };
  }
}
