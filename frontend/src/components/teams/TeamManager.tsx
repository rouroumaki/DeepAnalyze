// =============================================================================
// DeepAnalyze - TeamManager Component
// Lists agent teams as cards with CRUD operations
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { agentTeamsApi, type TeamInfo } from "../../api/agentTeams";
import { TeamEditor } from "./TeamEditor";
import {
  Plus,
  Users,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Mode badge colors
// ---------------------------------------------------------------------------

const MODE_STYLES: Record<string, { bg: string; color: string }> = {
  pipeline: { bg: "color-mix(in srgb, var(--interactive) 15%, transparent)", color: "var(--interactive)" },
  graph: { bg: "color-mix(in srgb, var(--success) 15%, transparent)", color: "var(--success)" },
  council: { bg: "color-mix(in srgb, var(--warning) 15%, transparent)", color: "var(--warning)" },
  parallel: { bg: "color-mix(in srgb, #a78bfa 15%, transparent)", color: "#a78bfa" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamManager() {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTeam, setEditingTeam] = useState<TeamInfo | null | "create">(null);

  // ---- Load teams ----
  const loadTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await agentTeamsApi.list();
      setTeams(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // ---- Delete handler ----
  const handleDelete = async (id: string) => {
    try {
      await agentTeamsApi.delete(id);
      setTeams((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete team");
    }
  };

  // ---- Save callback from TeamEditor ----
  const handleSaved = useCallback(() => {
    setEditingTeam(null);
    loadTeams();
  }, [loadTeams]);

  // ---- Render ----

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-2)",
          padding: "var(--space-8)",
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
        }}
      >
        <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
        Loading teams...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ---- Toolbar ---- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border-primary)",
          flexShrink: 0,
        }}
      >
        <Users size={16} style={{ color: "var(--interactive)" }} />
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--font-semibold)",
            color: "var(--text-primary)",
            flex: 1,
          }}
        >
          Agent Teams
        </span>

        <button
          onClick={() => setEditingTeam("create")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "var(--text-xs)",
            fontWeight: "var(--font-medium)",
            color: "var(--interactive)",
            background: "transparent",
            border: "1px solid var(--interactive)",
            borderRadius: "var(--radius-md)",
            padding: "4px 10px",
            cursor: "pointer",
            transition: "all var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--interactive)";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--interactive)";
          }}
        >
          <Plus size={12} />
          新建团队
        </button>
      </div>

      {/* ---- Error banner ---- */}
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-4)",
            background: "color-mix(in srgb, var(--error) 10%, transparent)",
            color: "var(--error)",
            fontSize: "var(--text-xs)",
          }}
        >
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* ---- Team list ---- */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-3) var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {teams.length === 0 && !error && (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-8)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
            }}
          >
            No teams yet. Click "+ 新建团队" to create one.
          </div>
        )}

        {teams.map((team) => {
          const modeStyle = MODE_STYLES[team.mode] ?? MODE_STYLES.pipeline;

          return (
            <div
              key={team.id}
              style={{
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-3)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                background: "var(--bg-secondary)",
                transition: "box-shadow var(--transition-fast)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow =
                  "0 1px 4px color-mix(in srgb, var(--bg-primary) 80%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {/* Team info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--font-semibold)",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {team.name}
                  </span>

                  {/* Mode badge */}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: "var(--font-medium)",
                      padding: "1px 6px",
                      borderRadius: "var(--radius-sm)",
                      background: modeStyle.bg,
                      color: modeStyle.color,
                      textTransform: "capitalize",
                      flexShrink: 0,
                    }}
                  >
                    {team.mode}
                  </span>

                  {/* Member count */}
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--text-tertiary)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      flexShrink: 0,
                    }}
                  >
                    <Users size={10} />
                    {team.members.length}
                  </span>
                </div>

                {team.description && (
                  <div
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)",
                      lineHeight: 1.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {team.description}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "var(--space-1)", flexShrink: 0 }}>
                <button
                  onClick={() => setEditingTeam(team)}
                  title="Edit"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-tertiary)",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--interactive)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-tertiary)";
                  }}
                >
                  <Pencil size={14} />
                </button>

                <button
                  onClick={() => handleDelete(team.id)}
                  title="Delete"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-tertiary)",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "color-mix(in srgb, var(--error) 10%, transparent)";
                    e.currentTarget.style.color = "var(--error)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-tertiary)";
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- TeamEditor modal ---- */}
      {editingTeam !== null && (
        <TeamEditor
          team={editingTeam === "create" ? null : editingTeam}
          onClose={() => setEditingTeam(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
