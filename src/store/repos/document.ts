// =============================================================================
// DeepAnalyze - PgDocumentRepo
// PostgreSQL implementation of DocumentRepo.
// CRUD operations for document records with processing status tracking.
// =============================================================================

import pg from 'pg';
import type { DocumentRepo, Document } from './interfaces';

export class PgDocumentRepo implements DocumentRepo {
  constructor(private pool: pg.Pool) {}

  async getById(id: string): Promise<Document | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM documents WHERE id = $1',
      [id],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getByKbId(kbId: string): Promise<Document[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM documents WHERE kb_id = $1 ORDER BY created_at DESC',
      [kbId],
    );
    return rows.map((r: any) => this.mapRow(r));
  }

  async create(doc: Omit<Document, 'id' | 'created_at'>): Promise<Document> {
    const { rows } = await this.pool.query(
      `INSERT INTO documents (kb_id, filename, file_path, file_hash, file_size, file_type, status, metadata, processing_step, processing_progress, processing_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        doc.kb_id,
        doc.filename,
        doc.file_path,
        doc.file_hash,
        doc.file_size,
        doc.file_type,
        doc.status,
        JSON.stringify(doc.metadata ?? {}),
        doc.processing_step ?? null,
        doc.processing_progress ?? 0,
        doc.processing_error ?? null,
      ],
    );
    return this.mapRow(rows[0]);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.pool.query(
      'UPDATE documents SET status = $1 WHERE id = $2',
      [status, id],
    );
  }

  async updateProcessing(id: string, step: string, progress: number, error?: string): Promise<void> {
    await this.pool.query(
      'UPDATE documents SET processing_step = $1, processing_progress = $2, processing_error = $3 WHERE id = $4',
      [step, progress, error ?? null, id],
    );
  }

  async deleteById(id: string): Promise<void> {
    await this.pool.query('DELETE FROM documents WHERE id = $1', [id]);
  }

  async deleteByKbId(kbId: string): Promise<void> {
    await this.pool.query('DELETE FROM documents WHERE kb_id = $1', [kbId]);
  }

  private mapRow(row: any): Document {
    return {
      ...row,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    };
  }
}
