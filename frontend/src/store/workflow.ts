// =============================================================================
// DeepAnalyze - Workflow State Store
// Manages active multi-agent workflow state driven by WebSocket events
// =============================================================================

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentState {
  agentId: string;
  role: string;
  task: string;
  status: "queued" | "running" | "waiting" | "completed" | "error";
  duration: number;
  toolCallCount: number;
  progress: number;
  messages: Array<{ type: string; content: string }>;
}

export interface ActiveWorkflow {
  workflowId: string;
  teamName: string;
  mode: string;
  startedAt: string;
  agents: Map<string, AgentState>;
}

export interface WorkflowState {
  // Data – keyed by workflowId
  activeWorkflows: Map<string, ActiveWorkflow>;

  // Event handlers – called by the WebSocket handler in chat.ts
  handleWorkflowStart: (event: {
    workflowId: string;
    teamName: string;
    mode: string;
    agentCount: number;
  }) => void;

  handleAgentStart: (event: {
    workflowId: string;
    agentId: string;
    role: string;
    task: string;
  }) => void;

  handleAgentToolCall: (event: {
    workflowId: string;
    agentId: string;
    toolName: string;
    input: Record<string, unknown>;
  }) => void;

  handleAgentToolResult: (event: {
    workflowId: string;
    agentId: string;
    toolName: string;
    output: string;
  }) => void;

  handleAgentChunk: (event: {
    workflowId: string;
    agentId: string;
    content: string;
  }) => void;

  handleAgentComplete: (event: {
    workflowId: string;
    agentId: string;
    output?: string;
    error?: string;
    duration: number;
  }) => void;

  handleWorkflowComplete: (event: {
    workflowId: string;
    status: string;
    duration: number;
  }) => void;

  // Manual clean-up
  clearWorkflow: (workflowId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience wrapper to update a single workflow inside the Map immutably. */
function updateWorkflow(
  map: Map<string, ActiveWorkflow>,
  workflowId: string,
  updater: (wf: ActiveWorkflow) => ActiveWorkflow,
): Map<string, ActiveWorkflow> {
  const wf = map.get(workflowId);
  if (!wf) return map;
  const next = new Map(map);
  next.set(workflowId, updater(wf));
  return next;
}

/** Convenience wrapper to update a single agent inside a workflow's agent Map. */
function updateAgent(
  agents: Map<string, AgentState>,
  agentId: string,
  updater: (agent: AgentState) => AgentState,
): Map<string, AgentState> {
  const agent = agents.get(agentId);
  if (!agent) return agents;
  const next = new Map(agents);
  next.set(agentId, updater(agent));
  return next;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  activeWorkflows: new Map(),

  // ---- Workflow lifecycle ----

  handleWorkflowStart: (event) => {
    set((state) => {
      const next = new Map(state.activeWorkflows);
      next.set(event.workflowId, {
        workflowId: event.workflowId,
        teamName: event.teamName,
        mode: event.mode,
        startedAt: new Date().toISOString(),
        agents: new Map(),
      });
      return { activeWorkflows: next };
    });
  },

  handleAgentStart: (event) => {
    set((state) => ({
      activeWorkflows: updateWorkflow(state.activeWorkflows, event.workflowId, (wf) => {
        const nextAgents = new Map(wf.agents);
        nextAgents.set(event.agentId, {
          agentId: event.agentId,
          role: event.role,
          task: event.task,
          status: "running",
          duration: 0,
          toolCallCount: 0,
          progress: 0,
          messages: [],
        });
        return { ...wf, agents: nextAgents };
      }),
    }));
  },

  handleAgentToolCall: (event) => {
    set((state) => ({
      activeWorkflows: updateWorkflow(state.activeWorkflows, event.workflowId, (wf) => ({
        ...wf,
        agents: updateAgent(wf.agents, event.agentId, (agent) => ({
          ...agent,
          toolCallCount: agent.toolCallCount + 1,
          messages: [
            ...agent.messages,
            { type: "tool_call", content: `${event.toolName}(${JSON.stringify(event.input)})` },
          ],
        })),
      })),
    }));
  },

  handleAgentToolResult: (event) => {
    set((state) => ({
      activeWorkflows: updateWorkflow(state.activeWorkflows, event.workflowId, (wf) => ({
        ...wf,
        agents: updateAgent(wf.agents, event.agentId, (agent) => ({
          ...agent,
          messages: [
            ...agent.messages,
            { type: "tool_result", content: `${event.toolName}: ${event.output}` },
          ],
        })),
      })),
    }));
  },

  handleAgentChunk: (event) => {
    set((state) => ({
      activeWorkflows: updateWorkflow(state.activeWorkflows, event.workflowId, (wf) => ({
        ...wf,
        agents: updateAgent(wf.agents, event.agentId, (agent) => ({
          ...agent,
          messages: [
            ...agent.messages,
            { type: "chunk", content: event.content },
          ],
        })),
      })),
    }));
  },

  handleAgentComplete: (event) => {
    set((state) => ({
      activeWorkflows: updateWorkflow(state.activeWorkflows, event.workflowId, (wf) => ({
        ...wf,
        agents: updateAgent(wf.agents, event.agentId, (agent) => ({
          ...agent,
          status: event.error ? "error" : "completed",
          duration: event.duration,
          progress: 100,
          messages: event.error
            ? [...agent.messages, { type: "error", content: event.error }]
            : event.output
              ? [...agent.messages, { type: "output", content: event.output }]
              : agent.messages,
        })),
      })),
    }));
  },

  handleWorkflowComplete: (event) => {
    // Mark all remaining "running" agents as completed, then auto-cleanup
    // after a delay so the UI can display the final state briefly.
    set((state) => {
      const wf = state.activeWorkflows.get(event.workflowId);
      if (!wf) return state;

      const updatedAgents = new Map(wf.agents);
      for (const [agentId, agent] of updatedAgents) {
        if (agent.status === "running" || agent.status === "waiting" || agent.status === "queued") {
          updatedAgents.set(agentId, { ...agent, status: "completed", duration: event.duration });
        }
      }

      return {
        activeWorkflows: updateWorkflow(state.activeWorkflows, event.workflowId, (wf) => ({
          ...wf,
          agents: updatedAgents,
        })),
      };
    });

    // Auto-cleanup after 30 seconds to prevent memory leak
    setTimeout(() => {
      get().clearWorkflow(event.workflowId);
    }, 30_000);
  },

  clearWorkflow: (workflowId) => {
    set((state) => {
      const next = new Map(state.activeWorkflows);
      next.delete(workflowId);
      return { activeWorkflows: next };
    });
  },
}));
