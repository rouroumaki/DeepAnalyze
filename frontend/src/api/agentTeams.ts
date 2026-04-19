// =============================================================================
// DeepAnalyze - Agent Teams API Client
// CRUD operations for agent teams and workflow templates
// =============================================================================

import { api } from "./client.js";

export interface TeamMember {
  id: string;
  role: string;
  task: string;
  tools: string[];
  dependsOn: string[];
  perspective?: string;
  systemPrompt?: string;
}

export interface TeamInfo {
  id: string;
  name: string;
  description: string;
  mode: "pipeline" | "graph" | "council" | "parallel";
  isActive: boolean;
  crossReview: boolean;
  members: TeamMember[];
  createdAt: string;
}

export const agentTeamsApi = {
  list: () =>
    api.get<{ teams: TeamInfo[] }>("/api/agent-teams").then((r) => r.teams),

  get: (id: string) =>
    api.get<TeamInfo>(`/api/agent-teams/${id}`),

  create: (data: Partial<TeamInfo>) =>
    api.post<TeamInfo>("/api/agent-teams", data),

  update: (id: string, data: Partial<TeamInfo>) =>
    api.put(`/api/agent-teams/${id}`, data),

  delete: (id: string) =>
    api.delete(`/api/agent-teams/${id}`),

  templates: () =>
    api.get<{ templates: TeamInfo[] }>("/api/agent-teams/templates").then((r) => r.templates),
};
