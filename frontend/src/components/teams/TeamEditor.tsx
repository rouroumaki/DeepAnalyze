// =============================================================================
// DeepAnalyze - TeamEditor Component
// Modal form for creating / editing an agent team
// =============================================================================

import { useState, useCallback } from "react";
import { agentTeamsApi, type TeamInfo, type TeamMember } from "../../api/agentTeams";
import { X, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TeamEditorProps {
  /** null = create mode, otherwise edit existing team */
  team: TeamInfo | null;
  /** Close the modal */
  onClose: () => void;
  /** Called after a successful save */
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Mode options
// ---------------------------------------------------------------------------

const MODE_OPTIONS: Array<{ value: TeamInfo["mode"]; label: string }> = [
  { value: "pipeline", label: "Pipeline (sequential)" },
  { value: "parallel", label: "Parallel" },
  { value: "council", label: "Council (debate)" },
  { value: "graph", label: "Graph (DAG)" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let memberSeq = 0;
function nextMemberId(): string {
  return `member-${Date.now()}-${++memberSeq}`;
}

function emptyMember(): TeamMember {
  return {
    id: nextMemberId(),
    role: "",
    task: "",
    tools: [],
    dependsOn: [],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamEditor({ team, onClose, onSaved }: TeamEditorProps) {
  const isCreate = team === null;

  // Form state
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [mode, setMode] = useState<TeamInfo["mode"]>(team?.mode ?? "pipeline");
  const [members, setMembers] = useState<TeamMember[]>(
    team?.members?.length ? team.members.map((m) => ({ ...m })) : [emptyMember()],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Member mutation helpers ----

  const updateMember = useCallback(
    (index: number, patch: Partial<TeamMember>) => {
      setMembers((prev) =>
        prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
      );
    },
    [],
  );

  const addMember = useCallback(() => {
    setMembers((prev) => [...prev, emptyMember()]);
  }, []);

  const removeMember = useCallback((index: number) => {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---- Save ----

  const handleSave = async () => {
    // Basic validation
    if (!name.trim()) {
      setError("Team name is required");
      return;
    }

    const validMembers = members.filter((m) => m.role.trim() || m.task.trim());
    if (validMembers.length === 0) {
      setError("At least one member with a role is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payload: Partial<TeamInfo> = {
        name: name.trim(),
        description: description.trim(),
        mode,
        members: validMembers,
        isActive: true,
        crossReview: false,
      };

      if (isCreate) {
        await agentTeamsApi.create(payload);
      } else {
        await agentTeamsApi.update(team.id, payload);
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ---- Render ----

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "color-mix(in srgb, black 50%, transparent)",
      }}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-primary)",
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--border-primary)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- Header ---- */}
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
          <span
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-semibold)",
              color: "var(--text-primary)",
              flex: 1,
            }}
          >
            {isCreate ? "新建团队" : "编辑团队"}
          </span>
          <button
            onClick={onClose}
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
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ---- Body (scrollable) ---- */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {/* Error */}
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-2) var(--space-3)",
                background: "color-mix(in srgb, var(--error) 10%, transparent)",
                color: "var(--error)",
                fontSize: "var(--text-xs)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Name field */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: "var(--font-medium)",
                color: "var(--text-secondary)",
              }}
            >
              Team Name *
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research Team"
              style={{
                fontSize: "var(--text-sm)",
                padding: "6px 10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-primary)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                outline: "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--interactive)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border-primary)";
              }}
            />
          </label>

          {/* Description field */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: "var(--font-medium)",
                color: "var(--text-secondary)",
              }}
            >
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the team's purpose"
              rows={2}
              style={{
                fontSize: "var(--text-sm)",
                padding: "6px 10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-primary)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--interactive)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border-primary)";
              }}
            />
          </label>

          {/* Mode select */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: "var(--font-medium)",
                color: "var(--text-secondary)",
              }}
            >
              Mode
            </span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as TeamInfo["mode"])}
              style={{
                fontSize: "var(--text-sm)",
                padding: "6px 10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-primary)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {/* ---- Members section ---- */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: "var(--font-medium)",
                  color: "var(--text-secondary)",
                  flex: 1,
                }}
              >
                Members ({members.length})
              </span>
              <button
                onClick={addMember}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: 10,
                  color: "var(--interactive)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                }}
              >
                <Plus size={10} />
                Add
              </button>
            </div>

            {members.map((member, index) => (
              <div
                key={member.id}
                style={{
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-2) var(--space-3)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                  background: "var(--bg-secondary)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: "var(--font-medium)",
                      color: "var(--text-tertiary)",
                      width: 20,
                      textAlign: "center",
                    }}
                  >
                    #{index + 1}
                  </span>

                  {/* Role */}
                  <input
                    type="text"
                    value={member.role}
                    onChange={(e) =>
                      updateMember(index, { role: e.target.value })
                    }
                    placeholder="Role (e.g. researcher)"
                    style={{
                      flex: 1,
                      fontSize: "var(--text-xs)",
                      padding: "4px 8px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-primary)",
                      background: "var(--bg-primary)",
                      color: "var(--text-primary)",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "var(--interactive)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-primary)";
                    }}
                  />

                  {/* Remove button */}
                  {members.length > 1 && (
                    <button
                      onClick={() => removeMember(index)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        borderRadius: "var(--radius-sm)",
                        border: "none",
                        background: "transparent",
                        color: "var(--text-tertiary)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--error)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--text-tertiary)";
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {/* Task */}
                <input
                  type="text"
                  value={member.task}
                  onChange={(e) =>
                    updateMember(index, { task: e.target.value })
                  }
                  placeholder="Task description"
                  style={{
                    fontSize: "var(--text-xs)",
                    padding: "4px 8px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-primary)",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--interactive)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-primary)";
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ---- Footer ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "var(--space-2)",
            padding: "var(--space-3) var(--space-4)",
            borderTop: "1px solid var(--border-primary)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              fontSize: "var(--text-xs)",
              padding: "6px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-primary)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "var(--text-xs)",
              fontWeight: "var(--font-medium)",
              padding: "6px 14px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "var(--interactive)",
              color: "white",
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
            {isCreate ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
