import { randomUUID } from "node:crypto";
import pg from "pg";
import type {
  AgentSkillRepo,
  AgentSkill,
  NewAgentSkill,
  UpdateAgentSkill,
} from "./interfaces.js";

export class PgAgentSkillRepo implements AgentSkillRepo {
  constructor(private pool: pg.Pool) {}

  async create(data: NewAgentSkill): Promise<AgentSkill> {
    const id = data.id ?? randomUUID();
    const tools = data.tools ?? ["*"];
    const { rows } = await this.pool.query(
      `INSERT INTO agent_skills (id, name, description, prompt, tools, model_role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        data.name,
        data.description ?? "",
        data.prompt,
        tools,  // PostgreSQL driver handles JS arrays natively for TEXT[]
        data.modelRole ?? "main",
        data.isActive !== false,
      ],
    );
    return this.mapRow(rows[0]);
  }

  async get(id: string): Promise<AgentSkill | undefined> {
    const { rows } = await this.pool.query(
      "SELECT * FROM agent_skills WHERE id = $1",
      [id],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getByName(name: string): Promise<AgentSkill | undefined> {
    const { rows } = await this.pool.query(
      "SELECT * FROM agent_skills WHERE name = $1",
      [name],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async list(): Promise<AgentSkill[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM agent_skills ORDER BY created_at DESC",
    );
    return rows.map((r) => this.mapRow(r));
  }

  async listActive(): Promise<AgentSkill[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM agent_skills WHERE is_active = true ORDER BY created_at DESC",
    );
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, data: UpdateAgentSkill): Promise<AgentSkill | undefined> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
    if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description); }
    if (data.prompt !== undefined) { sets.push(`prompt = $${idx++}`); params.push(data.prompt); }
    if (data.tools !== undefined) { sets.push(`tools = $${idx++}`); params.push(data.tools); }
    if (data.modelRole !== undefined) { sets.push(`model_role = $${idx++}`); params.push(data.modelRole); }
    if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }

    if (sets.length === 0) return this.get(id);

    sets.push(`updated_at = now()`);
    params.push(id);

    const { rows } = await this.pool.query(
      `UPDATE agent_skills SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params,
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM agent_skills WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  private mapRow(row: Record<string, unknown>): AgentSkill {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? "",
      prompt: row.prompt as string,
      tools: Array.isArray(row.tools) ? row.tools as string[] : ["*"],
      modelRole: (row.model_role as string) ?? "main",
      isActive: row.is_active as boolean,
      createdAt: row.created_at instanceof Date ? (row.created_at as Date).toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? (row.updated_at as Date).toISOString() : String(row.updated_at),
    };
  }
}
