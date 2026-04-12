// =============================================================================
// DeepAnalyze - SkillBrowser Component
// Browse, create, execute and delete skills
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useChatStore } from "../../store/chat";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { Spinner } from "../ui/Spinner";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { TextArea } from "../ui/TextArea";
import type { SkillInfo, SkillVariableInfo } from "../../types/index";
import {
  Zap,
  Plus,
  Trash2,
  RefreshCw,
  Play,
  CheckCircle,
  Variable,
  Wrench,
  Package,
  AlertCircle,
} from "lucide-react";

// =============================================================================
// Main SkillBrowser component
// =============================================================================

export function SkillBrowser() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Execution state
  const [executeModalOpen, setExecuteModalOpen] = useState(false);
  const [executeSkillId, setExecuteSkillId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executingResult, setExecutingResult] = useState<{
    skillName: string;
    output: string;
  } | null>(null);

  // Create skill state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const currentSessionId = useChatStore((s) => s.currentSessionId);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.listSkills();
      setSkills(data);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load skills"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // ---- Delete handler ----
  const handleDelete = async (skill: SkillInfo) => {
    const ok = await confirm({
      title: "\u5220\u9664\u6280\u80FD",
      message: `\u786E\u5B9A\u8981\u5220\u9664\u6280\u80FD\u201C${skill.name}\u201D\u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`,
      variant: "danger",
    });
    if (!ok) return;
    setDeletingId(skill.id);
    try {
      await api.deleteSkill(skill.id);
      success(`\u6280\u80FD\u201C${skill.name}\u201D\u5DF2\u5220\u9664`);
      await loadSkills();
    } catch {
      toastError("\u5220\u9664\u5931\u8D25");
    } finally {
      setDeletingId(null);
    }
  };

  // ---- Execute handlers ----
  const openExecuteModal = (skillId: string) => {
    setExecuteSkillId(skillId);
    setExecuteModalOpen(true);
  };

  const closeExecuteModal = () => {
    setExecuteModalOpen(false);
    setExecuteSkillId(null);
  };

  const handleExecute = async (variables: Record<string, string>) => {
    if (!executeSkillId) return;
    const skill = skills.find((s) => s.id === executeSkillId);
    setExecuting(true);
    try {
      const result = await api.runSkill(
        currentSessionId ?? "",
        executeSkillId,
        variables
      );
      setExecutingResult({ skillName: skill?.name ?? "", output: result.output });
      success(`\u6280\u80FD\u201C${skill?.name}\u201D\u6267\u884C\u6210\u529F`);
    } catch (err) {
      toastError("\u6267\u884C\u5931\u8D25: " + String(err));
    }
    setExecuting(false);
    closeExecuteModal();
  };

  // ---- Create handler ----
  const handleCreate = async (data: {
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
  }) => {
    setCreating(true);
    try {
      await api.createSkill(data);
      success(`\u6280\u80FD\u201C${data.name}\u201D\u521B\u5EFA\u6210\u529F`);
      setCreateModalOpen(false);
      await loadSkills();
    } catch (err) {
      toastError("\u521B\u5EFA\u5931\u8D25: " + String(err));
    } finally {
      setCreating(false);
    }
  };

  // ===========================================================================
  // Loading state
  // ===========================================================================
  if (loading) {
    return (
      <div style={styles.centerContainer}>
        <Spinner size="lg" />
      </div>
    );
  }

  // ===========================================================================
  // Main render
  // ===========================================================================
  return (
    <>
      <div style={styles.wrapper}>
        {/* Execution result banner */}
        {executingResult && (
          <div style={styles.resultBanner}>
            <p style={styles.resultTitle}>
              <CheckCircle size={16} />
              {executingResult.skillName} \u6267\u884C\u6210\u529F
            </p>
            <pre style={styles.resultOutput}>{executingResult.output}</pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExecutingResult(null)}
            >
              \u5173\u95ED
            </Button>
          </div>
        )}

        {/* Toolbar */}
        <div style={styles.toolbar}>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setCreateModalOpen(true)}
          >
            {"\u521B\u5EFA\u6280\u80FD"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={loadSkills}
          >
            {"\u5237\u65B0"}
          </Button>
        </div>

        {/* Error display */}
        {loadError && (
          <div style={styles.errorBanner}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <div style={styles.errorText}>
              <strong>{"\u52A0\u8F7D\u5931\u8D25"}</strong>
              <p style={styles.errorMessage}>{loadError}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={loadSkills}
              style={{ marginLeft: "auto", flexShrink: 0 }}
            >
              {"\u91CD\u8BD5"}
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!loadError && skills.length === 0 ? (
          <EmptyState
            icon={<Package size={24} />}
            title={"\u6682\u65E0\u53EF\u7528\u6280\u80FD"}
            description={"\u521B\u5EFA\u4E00\u4E2A\u65B0\u6280\u80FD\u6765\u5F00\u59CB\u4F7F\u7528"}
            actionLabel={"\u521B\u5EFA\u6280\u80FD"}
            onAction={() => setCreateModalOpen(true)}
          />
        ) : (
          <div style={styles.grid}>
            {skills.map((skill) => (
              <div key={skill.id} style={styles.card}>
                {/* Header row */}
                <div style={styles.cardHeader}>
                  <h4 style={styles.cardName}>
                    <Zap size={14} style={{ color: "var(--interactive)", flexShrink: 0 }} />
                    {skill.name}
                  </h4>
                  <div style={styles.cardBadges}>
                    {skill.pluginId && (
                      <Badge variant="info" size="sm">
                        {"\u63D2\u4EF6"}
                      </Badge>
                    )}
                    {skill.variables && skill.variables.length > 0 && (
                      <Badge variant="default" size="sm">
                        <Variable size={10} style={{ marginRight: 2 }} />
                        {skill.variables.length + " \u53C2\u6570"}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p style={styles.cardDescription}>{skill.description}</p>

                {/* Tool tags */}
                {skill.tools.length > 0 && (
                  <div style={styles.toolsRow}>
                    {skill.tools.slice(0, 4).map((t) => (
                      <span key={t} style={styles.toolTag}>
                        <Wrench size={9} />
                        {t}
                      </span>
                    ))}
                    {skill.tools.length > 4 && (
                      <span style={styles.toolMore}>
                        {"+" + (skill.tools.length - 4)}
                      </span>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div style={styles.cardActions}>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={14} />}
                    onClick={() => openExecuteModal(skill.id)}
                    disabled={!currentSessionId}
                  >
                    {"\u6267\u884C"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={
                      deletingId === skill.id ? (
                        <Spinner size="sm" color="currentColor" />
                      ) : (
                        <Trash2 size={14} />
                      )
                    }
                    onClick={() => handleDelete(skill)}
                    disabled={deletingId === skill.id}
                    style={
                      deletingId === skill.id
                        ? undefined
                        : { color: "var(--text-tertiary)" }
                    }
                  >
                    {"\u5220\u9664"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skill Execution Modal */}
      {executeModalOpen && executeSkillId && (
        <SkillExecuteModal
          skillId={executeSkillId}
          skills={skills}
          sessionId={currentSessionId}
          executing={executing}
          onExecute={handleExecute}
          onClose={closeExecuteModal}
        />
      )}

      {/* Create Skill Modal */}
      {createModalOpen && (
        <CreateSkillModal
          creating={creating}
          onCreate={handleCreate}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
    </>
  );
}

// =============================================================================
// SkillExecuteModal - modal for variable input before execution
// =============================================================================

function SkillExecuteModal({
  skillId,
  skills,
  sessionId,
  executing,
  onExecute,
  onClose,
}: {
  skillId: string;
  skills: SkillInfo[];
  sessionId: string | null;
  executing: boolean;
  onExecute: (vars: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const skill = skills.find((s) => s.id === skillId);
  const [vars, setVars] = useState<Record<string, string>>({});

  if (!skill) return null;

  const handleExecute = async () => {
    await onExecute(vars);
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={"\u6267\u884C\u6280\u80FD: " + skill.name}
      size="md"
    >
      {/* Skill description */}
      <p style={styles.modalDescription}>{skill.description}</p>

      {/* Variables or info */}
      {skill.variables && skill.variables.length > 0 ? (
        <div style={styles.varGrid}>
          {skill.variables.map((v: SkillVariableInfo) => (
            <Input
              key={v.name}
              label={v.description || v.name}
              value={vars[v.name] ?? v.defaultValue ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setVars((prev) => ({ ...prev, [v.name]: e.target.value }))
              }
              placeholder={v.defaultValue || ""}
            />
          ))}
        </div>
      ) : (
        <p style={styles.noVarsHint}>{"\u6B64\u6280\u80FD\u65E0\u9700\u53C2\u6570"}</p>
      )}

      {/* Session warning */}
      {!sessionId && (
        <div style={styles.sessionWarning}>
          <AlertCircle size={14} />
          <span>{"\u8BF7\u5148\u521B\u5EFA\u4E00\u4E2A\u4F1A\u8BDD\u4EE5\u6267\u884C\u6280\u80FD"}</span>
        </div>
      )}

      {/* Action buttons */}
      <div style={styles.modalFooter}>
        <Button variant="secondary" onClick={onClose}>
          {"\u53D6\u6D88"}
        </Button>
        <Button
          variant="primary"
          onClick={handleExecute}
          loading={executing}
          disabled={!sessionId}
          icon={<Play size={14} />}
        >
          {"\u6267\u884C"}
        </Button>
      </div>
    </Modal>
  );
}

// =============================================================================
// CreateSkillModal - modal for creating a new skill
// =============================================================================

function CreateSkillModal({
  creating,
  onCreate,
  onClose,
}: {
  creating: boolean;
  onCreate: (data: {
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [toolsInput, setToolsInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async () => {
    // Validate
    if (!name.trim()) {
      setFormError("\u8BF7\u8F93\u5165\u6280\u80FD\u540D\u79F0");
      return;
    }
    if (!systemPrompt.trim()) {
      setFormError("\u8BF7\u8F93\u5165\u7CFB\u7EDF\u63D0\u793A\u8BCD");
      return;
    }

    const tools = toolsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    setFormError(null);
    await onCreate({
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      tools,
    });
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={"\u521B\u5EFA\u65B0\u6280\u80FD"}
      size="lg"
    >
      <div style={styles.formContainer}>
        {/* Form error */}
        {formError && (
          <div style={styles.formError}>
            <AlertCircle size={14} />
            {formError}
          </div>
        )}

        {/* Name field */}
        <Input
          label={"\u6280\u80FD\u540D\u79F0" + " *"}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder={"e.g. summarize_document"}
          hint={"\u6280\u80FD\u7684\u552F\u4E00\u6807\u8BC6\u7B26"}
        />

        {/* Description field */}
        <Input
          label={"\u63CF\u8FF0"}
          value={description}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
          placeholder={"\u7B80\u8981\u63CF\u8FF0\u8BE5\u6280\u80FD\u7684\u7528\u9014"}
        />

        {/* System Prompt field */}
        <TextArea
          label={"\u7CFB\u7EDF\u63D0\u793A\u8BCD" + " *"}
          value={systemPrompt}
          onChange={setSystemPrompt}
          placeholder={"\u5B9A\u4E49\u6280\u80FD\u7684\u884C\u4E3A\u548C\u6307\u4EE4..."}
          rows={5}
        />

        {/* Tools field */}
        <Input
          label={"\u5DE5\u5177\u5217\u8868"}
          value={toolsInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToolsInput(e.target.value)}
          placeholder={"tool_a, tool_b, tool_c"}
          hint={"\u9017\u53F7\u5206\u9694\u7684\u5DE5\u5177\u540D\u79F0\u5217\u8868"}
        />

        {/* Action buttons */}
        <div style={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose}>
            {"\u53D6\u6D88"}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={creating}
            icon={<Plus size={14} />}
          >
            {"\u521B\u5EFA"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  centerContainer: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  // Toolbar
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },

  // Error banner (matches PluginManager pattern)
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--error-light)",
    border: "1px solid var(--error)",
    borderRadius: "var(--radius-lg)",
    color: "var(--error-dark)",
  },
  errorText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  errorMessage: {
    fontSize: "var(--text-xs)",
    margin: 0,
    opacity: 0.85,
    wordBreak: "break-word" as const,
  },

  // Execution result banner
  resultBanner: {
    padding: "var(--space-3) var(--space-4)",
    background: "var(--success-light)",
    border: "1px solid var(--success)",
    borderRadius: "var(--radius-lg)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  resultTitle: {
    fontSize: "var(--text-sm)",
    fontWeight: "var(--font-medium)" as unknown as number,
    color: "var(--success)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    margin: 0,
  },
  resultOutput: {
    fontSize: "var(--text-xs)",
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap" as const,
    maxHeight: 160,
    overflowY: "auto" as const,
    margin: 0,
    background: "var(--bg-primary)",
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-md)",
  },

  // Grid of skill cards
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "var(--space-4)",
  },

  // Individual card
  card: {
    padding: "var(--space-4) var(--space-5)",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-primary)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-sm)",
    display: "flex",
    flexDirection: "column",
  },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "var(--space-2)",
  },
  cardName: {
    fontSize: "var(--text-sm)",
    fontWeight: "var(--font-medium)" as unknown as number,
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    margin: 0,
  },
  cardBadges: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-1)",
    flexShrink: 0,
  },
  cardDescription: {
    fontSize: "var(--text-xs)",
    color: "var(--text-secondary)",
    marginBottom: "var(--space-3)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    margin: "0 0 var(--space-3) 0",
    lineHeight: "var(--leading-relaxed)" as unknown as number,
  },

  // Tool tags
  toolsRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "var(--space-1)",
    marginBottom: "var(--space-3)",
  },
  toolTag: {
    fontSize: "10px",
    padding: "2px 6px",
    background: "var(--bg-tertiary)",
    color: "var(--text-tertiary)",
    borderRadius: "var(--radius-sm)",
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
  },
  toolMore: {
    fontSize: "10px",
    color: "var(--text-tertiary)",
  },

  // Card actions
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    marginTop: "auto",
  },

  // Modal styles
  modalDescription: {
    fontSize: "var(--text-sm)",
    color: "var(--text-secondary)",
    margin: "0 0 var(--space-4) 0",
    lineHeight: "var(--leading-relaxed)" as unknown as number,
  },
  varGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
    marginBottom: "var(--space-4)",
  },
  noVarsHint: {
    fontSize: "var(--text-sm)",
    color: "var(--text-tertiary)",
    marginBottom: "var(--space-4)",
    margin: "0 0 var(--space-4) 0",
  },
  sessionWarning: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-2) var(--space-3)",
    background: "var(--warning-light)",
    color: "var(--warning-dark)",
    borderRadius: "var(--radius-md)",
    fontSize: "var(--text-xs)",
    marginBottom: "var(--space-4)",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "var(--space-2)",
    marginTop: "var(--space-4)",
  },

  // Create form
  formContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  formError: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-2) var(--space-3)",
    background: "var(--error-light)",
    color: "var(--error-dark)",
    borderRadius: "var(--radius-md)",
    fontSize: "var(--text-xs)",
  },
};
