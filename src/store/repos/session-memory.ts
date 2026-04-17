import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { SessionMemoryRepo, SessionMemory } from './interfaces';

export class PgSessionMemoryRepo implements SessionMemoryRepo {
  constructor(private pool: pg.Pool) {}

  async load(sessionId: string): Promise<SessionMemory | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM session_memory WHERE session_id = $1', [sessionId]);
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async save(sessionId: string, content: string, tokenCount: number, lastTokenPosition: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO session_memory (id, session_id, content, token_count, last_token_position) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET content = $3, token_count = $4, last_token_position = $5, updated_at = now()`,
      [randomUUID(), sessionId, content, tokenCount, lastTokenPosition],
    );
  }

  async listRecent(limit: number): Promise<Array<{ sessionId: string; content: string }>> {
    const { rows } = await this.pool.query(
      'SELECT session_id, content FROM session_memory ORDER BY updated_at DESC LIMIT $1', [limit],
    );
    return rows.map(r => ({ sessionId: r.session_id, content: r.content }));
  }

  private mapRow(row: any): SessionMemory {
    return {
      id: row.id, sessionId: row.session_id, content: row.content,
      tokenCount: row.token_count, lastTokenPosition: row.last_token_position,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }
}
