// =============================================================================
// DeepAnalyze - Agent Team Data Operations
// CRUD operations for agent teams and their members in the SQLite database.
// =============================================================================

import { DB } from "./database.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamMode = "pipeline" | "graph" | "council" | "parallel";

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  mode: TeamMode;
  isActive: boolean;
  crossReview: boolean;
  enableSkills: boolean;
  modelConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTeamMember {
  id: string;
  teamId: string;
  role: string;
  systemPrompt?: string;
  task: string;
  perspective?: string;
  dependsOn: string[];
  condition?: Record<string, unknown>;
  tools: string[];
  sortOrder: number;
}

export interface AgentTeamWithMembers extends AgentTeam {
  members: AgentTeamMember[];
}

export interface CreateTeamData {
  name: string;
  description: string;
  mode: TeamMode;
  isActive?: boolean;
  crossReview?: boolean;
  enableSkills?: boolean;
  modelConfig?: Record<string, unknown>;
  members: Omit<AgentTeamMember, "id" | "teamId">[];
}

export interface UpdateTeamData {
  name?: string;
  description?: string;
  mode?: TeamMode;
  isActive?: boolean;
  crossReview?: boolean;
  enableSkills?: boolean;
  modelConfig?: Record<string, unknown>;
  members?: Omit<AgentTeamMember, "id" | "teamId">[];
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * Run schema migration for agent_teams and agent_team_members tables.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function migrateAgentTeams(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_teams (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      mode        TEXT NOT NULL CHECK(mode IN ('pipeline', 'graph', 'council', 'parallel')),
      is_active   INTEGER NOT NULL DEFAULT 1,
      cross_review  INTEGER NOT NULL DEFAULT 0,
      enable_skills INTEGER NOT NULL DEFAULT 0,
      model_config TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_team_members (
      id               TEXT PRIMARY KEY,
      team_id          TEXT NOT NULL,
      role             TEXT NOT NULL,
      system_prompt    TEXT,
      task             TEXT NOT NULL,
      perspective      TEXT,
      depends_on       TEXT,
      condition_config TEXT,
      tools            TEXT NOT NULL,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (team_id) REFERENCES agent_teams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_team_members_team ON agent_team_members(team_id);
  `);
}

// ---------------------------------------------------------------------------
// Row-to-object mapping (snake_case DB -> camelCase JS)
// ---------------------------------------------------------------------------

function rowToAgentTeam(row: Record<string, unknown>): AgentTeam {
  let modelConfig: Record<string, unknown> | undefined;
  if (row.model_config) {
    try {
      modelConfig = JSON.parse(row.model_config as string);
    } catch {
      modelConfig = undefined;
    }
  }

  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    mode: row.mode as TeamMode,
    isActive: Boolean(row.is_active),
    crossReview: Boolean(row.cross_review),
    enableSkills: Boolean(row.enable_skills),
    modelConfig,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToAgentTeamMember(row: Record<string, unknown>): AgentTeamMember {
  let dependsOn: string[] = [];
  if (row.depends_on) {
    try {
      const parsed = JSON.parse(row.depends_on as string);
      dependsOn = Array.isArray(parsed) ? parsed : [];
    } catch {
      dependsOn = [];
    }
  }

  let condition: Record<string, unknown> | undefined;
  if (row.condition_config) {
    try {
      condition = JSON.parse(row.condition_config as string);
    } catch {
      condition = undefined;
    }
  }

  let tools: string[] = [];
  if (row.tools) {
    try {
      const parsed = JSON.parse(row.tools as string);
      tools = Array.isArray(parsed) ? parsed : [];
    } catch {
      tools = [];
    }
  }

  return {
    id: row.id as string,
    teamId: row.team_id as string,
    role: row.role as string,
    systemPrompt: (row.system_prompt as string) || undefined,
    task: row.task as string,
    perspective: (row.perspective as string) || undefined,
    dependsOn,
    condition,
    tools,
    sortOrder: row.sort_order as number,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new agent team with its members.
 * Inserts the team row and all associated member rows in a single transaction.
 */
export function createTeam(data: CreateTeamData): AgentTeamWithMembers {
  const db = DB.getInstance().raw;
  const teamId = randomUUID();
  const modelConfigJson = data.modelConfig ? JSON.stringify(data.modelConfig) : null;

  const insertTeam = db.prepare(
    `INSERT INTO agent_teams (id, name, description, mode, is_active, cross_review, enable_skills, model_config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMember = db.prepare(
    `INSERT INTO agent_team_members (id, team_id, role, system_prompt, task, perspective, depends_on, condition_config, tools, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const doInsert = db.transaction(() => {
    insertTeam.run(
      teamId,
      data.name,
      data.description,
      data.mode,
      data.isActive !== false ? 1 : 0,
      data.crossReview ? 1 : 0,
      data.enableSkills ? 1 : 0,
      modelConfigJson,
    );

    const members: AgentTeamMember[] = [];

    if (data.members && data.members.length > 0) {
      for (const member of data.members) {
        const memberId = randomUUID();
        insertMember.run(
          memberId,
          teamId,
          member.role,
          member.systemPrompt ?? null,
          member.task,
          member.perspective ?? null,
          JSON.stringify(member.dependsOn ?? []),
          member.condition ? JSON.stringify(member.condition) : null,
          JSON.stringify(member.tools ?? []),
          member.sortOrder ?? 0,
        );
        members.push({
          id: memberId,
          teamId,
          role: member.role,
          systemPrompt: member.systemPrompt,
          task: member.task,
          perspective: member.perspective,
          dependsOn: member.dependsOn ?? [],
          condition: member.condition,
          tools: member.tools ?? [],
          sortOrder: member.sortOrder ?? 0,
        });
      }
    }

    return members;
  });

  const members = doInsert();

  // Fetch the created row to get the server-generated timestamps
  const row = db
    .prepare("SELECT * FROM agent_teams WHERE id = ?")
    .get(teamId) as Record<string, unknown>;

  const team = rowToAgentTeam(row);

  return { ...team, members };
}

/**
 * Get a single team by ID, including all its members.
 */
export function getTeam(teamId: string): AgentTeamWithMembers | undefined {
  const db = DB.getInstance().raw;

  const row = db
    .prepare("SELECT * FROM agent_teams WHERE id = ?")
    .get(teamId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const team = rowToAgentTeam(row);

  const memberRows = db
    .prepare("SELECT * FROM agent_team_members WHERE team_id = ? ORDER BY sort_order")
    .all(teamId) as Record<string, unknown>[];

  const members = memberRows.map(rowToAgentTeamMember);

  return { ...team, members };
}

/**
 * Look up a team by its unique name.
 */
export function getTeamByName(name: string): AgentTeamWithMembers | undefined {
  const db = DB.getInstance().raw;

  const row = db
    .prepare("SELECT * FROM agent_teams WHERE name = ?")
    .get(name) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const team = rowToAgentTeam(row);

  const memberRows = db
    .prepare("SELECT * FROM agent_team_members WHERE team_id = ? ORDER BY sort_order")
    .all(team.id) as Record<string, unknown>[];

  const members = memberRows.map(rowToAgentTeamMember);

  return { ...team, members };
}

/**
 * List all teams (without members), ordered by most recently updated first.
 */
export function listTeams(): AgentTeam[] {
  const db = DB.getInstance().raw;

  const rows = db
    .prepare("SELECT * FROM agent_teams ORDER BY updated_at DESC")
    .all() as Record<string, unknown>[];

  return rows.map(rowToAgentTeam);
}

/**
 * Partially update a team. If members are provided, deletes existing members
 * and replaces them with the new set.
 */
export function updateTeam(teamId: string, data: UpdateTeamData): AgentTeamWithMembers | undefined {
  const db = DB.getInstance().raw;

  // Check that the team exists
  const existing = db
    .prepare("SELECT * FROM agent_teams WHERE id = ?")
    .get(teamId) as Record<string, unknown> | undefined;

  if (!existing) return undefined;

  const insertMember = db.prepare(
    `INSERT INTO agent_team_members (id, team_id, role, system_prompt, task, perspective, depends_on, condition_config, tools, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const doUpdate = db.transaction(() => {
    // Build dynamic UPDATE for team fields
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      setClauses.push("name = ?");
      values.push(data.name);
    }
    if (data.description !== undefined) {
      setClauses.push("description = ?");
      values.push(data.description);
    }
    if (data.mode !== undefined) {
      setClauses.push("mode = ?");
      values.push(data.mode);
    }
    if (data.isActive !== undefined) {
      setClauses.push("is_active = ?");
      values.push(data.isActive ? 1 : 0);
    }
    if (data.crossReview !== undefined) {
      setClauses.push("cross_review = ?");
      values.push(data.crossReview ? 1 : 0);
    }
    if (data.enableSkills !== undefined) {
      setClauses.push("enable_skills = ?");
      values.push(data.enableSkills ? 1 : 0);
    }
    if (data.modelConfig !== undefined) {
      setClauses.push("model_config = ?");
      values.push(data.modelConfig ? JSON.stringify(data.modelConfig) : null);
    }

    // Always update the updated_at timestamp
    setClauses.push("updated_at = datetime('now')");

    if (setClauses.length > 0) {
      const sql = `UPDATE agent_teams SET ${setClauses.join(", ")} WHERE id = ?`;
      values.push(teamId);
      db.prepare(sql).run(...values);
    }

    // Replace members if provided
    if (data.members !== undefined) {
      db.prepare("DELETE FROM agent_team_members WHERE team_id = ?").run(teamId);

      for (const member of data.members) {
        const memberId = randomUUID();
        insertMember.run(
          memberId,
          teamId,
          member.role,
          member.systemPrompt ?? null,
          member.task,
          member.perspective ?? null,
          JSON.stringify(member.dependsOn ?? []),
          member.condition ? JSON.stringify(member.condition) : null,
          JSON.stringify(member.tools ?? []),
          member.sortOrder ?? 0,
        );
      }
    }
  });

  doUpdate();

  // Fetch the updated team with members
  return getTeam(teamId);
}

/**
 * Delete a team and all its associated members.
 * The CASCADE foreign key on agent_team_members handles cleanup automatically.
 */
export function deleteTeam(teamId: string): boolean {
  const db = DB.getInstance().raw;

  const result = db.prepare("DELETE FROM agent_teams WHERE id = ?").run(teamId);
  return result.changes > 0;
}
