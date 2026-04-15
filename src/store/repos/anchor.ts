// =============================================================================
// DeepAnalyze - PgAnchorRepo
// PostgreSQL implementation of AnchorRepo.
// Manages structural element anchors for documents.
// =============================================================================

import pg from 'pg';
import type { AnchorRepo, AnchorDef } from './interfaces';

export class PgAnchorRepo implements AnchorRepo {
  constructor(private pool: pg.Pool) {}

  async batchInsert(anchors: AnchorDef[]): Promise<void> {
    if (anchors.length === 0) return;
    for (const a of anchors) {
      await this.pool.query(
        `INSERT INTO anchors (id, doc_id, kb_id, element_type, element_index, section_path, section_title, page_number, raw_json_path, structure_page_id, content_preview, content_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING`,
        [
          a.id,
          a.doc_id,
          a.kb_id,
          a.element_type,
          a.element_index,
          a.section_path ?? null,
          a.section_title ?? null,
          a.page_number ?? null,
          a.raw_json_path ?? null,
          a.structure_page_id ?? null,
          a.content_preview ?? null,
          a.content_hash ?? null,
          JSON.stringify(a.metadata ?? {}),
        ],
      );
    }
  }

  async getByDocId(docId: string): Promise<AnchorDef[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM anchors WHERE doc_id = $1 ORDER BY element_index',
      [docId],
    );
    return rows.map((r: any) => this.mapRow(r));
  }

  async getById(anchorId: string): Promise<AnchorDef | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM anchors WHERE id = $1',
      [anchorId],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getByStructurePageId(pageId: string): Promise<AnchorDef[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM anchors WHERE structure_page_id = $1 ORDER BY element_index',
      [pageId],
    );
    return rows.map((r: any) => this.mapRow(r));
  }

  async updateStructurePageId(anchorIds: string[], pageId: string): Promise<void> {
    await this.pool.query(
      'UPDATE anchors SET structure_page_id = $1 WHERE id = ANY($2)',
      [pageId, anchorIds],
    );
  }

  async deleteByDocId(docId: string): Promise<void> {
    await this.pool.query('DELETE FROM anchors WHERE doc_id = $1', [docId]);
  }

  private mapRow(row: any): AnchorDef {
    return {
      ...row,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    };
  }
}
