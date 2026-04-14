// =============================================================================
// DeepAnalyze - Agent Teams API Routes
// REST API for managing agent teams (CRUD + templates)
// =============================================================================

import { Hono } from "hono";
import { getTeamManager } from "../../services/agent/agent-system.js";
import type { CreateTeamData, UpdateTeamData } from "../../store/agent-teams.js";

export function createAgentTeamRoutes(): Hono {
  const router = new Hono();

  // -----------------------------------------------------------------------
  // Templates
  // -----------------------------------------------------------------------

  /** List all available team templates */
  router.get("/templates", async (c) => {
    const manager = await getTeamManager();
    const templates = manager.getTemplates();
    return c.json(templates);
  });

  // -----------------------------------------------------------------------
  // Team CRUD
  // -----------------------------------------------------------------------

  /** List all teams */
  router.get("/", async (c) => {
    const manager = await getTeamManager();
    const teams = manager.listTeams();
    return c.json(teams);
  });

  /** Get a single team by ID (with members) */
  router.get("/:id", async (c) => {
    const manager = await getTeamManager();
    const team = manager.getTeam(c.req.param("id"));
    if (!team) return c.json({ error: "Team not found" }, 404);
    return c.json(team);
  });

  /** Create a new team */
  router.post("/", async (c) => {
    const body = await c.req.json<CreateTeamData>();

    if (!body.name?.trim()) {
      return c.json({ error: "Team name is required" }, 400);
    }
    if (!body.mode) {
      return c.json({ error: "Team mode is required (pipeline | graph | council | parallel)" }, 400);
    }
    if (!body.members || body.members.length === 0) {
      return c.json({ error: "At least one team member is required" }, 400);
    }

    try {
      const manager = await getTeamManager();
      const team = manager.createTeam(body);
      return c.json(team, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to create team" }, 400);
    }
  });

  /** Update a team */
  router.put("/:id", async (c) => {
    const body = await c.req.json<UpdateTeamData>();

    try {
      const manager = await getTeamManager();
      const team = manager.updateTeam(c.req.param("id"), body);
      if (!team) return c.json({ error: "Team not found" }, 404);
      return c.json(team);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to update team" }, 400);
    }
  });

  /** Delete a team */
  router.delete("/:id", async (c) => {
    const manager = await getTeamManager();
    const ok = manager.deleteTeam(c.req.param("id"));
    if (!ok) return c.json({ error: "Team not found" }, 404);
    return c.json({ success: true });
  });

  return router;
}
