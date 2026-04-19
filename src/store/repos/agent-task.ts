import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AgentTaskRepo, AgentTask, NewAgentTask } from './interfaces';

export class PgAgentTaskRepo implements AgentTaskRepo {
  constructor(private pool: pg.Pool) {}

  async create(data: NewAgentTask): Promise<AgentTask> {
    // If an ID was provided, use it; otherwise generate one
    const id = data.id ?? randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO agent_tasks (id, parent_task_id, session_id, agent_type, status, input) VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [id, data.parentTaskId ?? null, data.sessionId ?? null, data.agentType, data.input ? JSON.stringify(data.input) : null],
    );
    return this.mapRow(rows[0]);
  }

  async updateStatus(id: string, status: string, output?: unknown, error?: string): Promise<void> {
    if (status === 'completed' || status === 'failed') {
      await this.pool.query(
        'UPDATE agent_tasks SET status = $1, output = $2, error = $3, completed_at = now() WHERE id = $4',
        [status, output ? JSON.stringify(output) : null, error ?? null, id],
      );
    } else {
      await this.pool.query('UPDATE agent_tasks SET status = $1 WHERE id = $2', [status, id]);
    }
  }

  async get(id: string): Promise<AgentTask | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM agent_tasks WHERE id = $1', [id]);
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async listBySession(sessionId: string): Promise<AgentTask[]> {
    const { rows } = await this.pool.query('SELECT * FROM agent_tasks WHERE session_id = $1 ORDER BY created_at DESC', [sessionId]);
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: any): AgentTask {
    return {
      id: row.id, parentTaskId: row.parent_task_id, sessionId: row.session_id,
      agentType: row.agent_type, status: row.status,
      input: this.safeParse(row.input),
      output: this.safeParse(row.output),
      error: row.error,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      completedAt: row.completed_at?.toISOString?.() ?? row.completed_at ?? null,
    };
  }

  /** Parse JSON if possible, otherwise return the raw value. */
  private safeParse(value: any): unknown {
    if (value == null) return null;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
