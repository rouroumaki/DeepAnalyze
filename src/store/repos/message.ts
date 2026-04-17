import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { MessageRepo, Message } from './interfaces';

export class PgMessageRepo implements MessageRepo {
  constructor(private pool: pg.Pool) {}

  async create(sessionId: string, role: string, content: string | null, metadata?: Record<string, unknown>): Promise<Message> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO messages (id, session_id, role, content, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, sessionId, role, content ?? '', metadata ? JSON.stringify(metadata) : null],
    );
    await this.pool.query('UPDATE sessions SET updated_at = now() WHERE id = $1', [sessionId]);
    return this.mapRow(rows[0]);
  }

  async list(sessionId: string): Promise<Message[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId],
    );
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: any): Message {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      metadata: typeof row.metadata === 'string' ? row.metadata : row.metadata ? JSON.stringify(row.metadata) : null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  }
}
