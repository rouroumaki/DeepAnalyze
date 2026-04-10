// =============================================================================
// DeepAnalyze - SkillBrowser Component
// Browse and execute skills with inline modal for variable input
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useChatStore } from "../../store/chat";
import { useToast } from "../../hooks/useToast";
import type { SkillInfo, SkillVariableInfo } from "../../types/index";
import {
  Zap,
  Play,
  X,
  Loader2,
  CheckCircle,
  Variable,
  Wrench,
  Package,
} from "lucide-react";

export function SkillBrowser() {
  const { success, error } = useToast();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSkillId, setModalSkillId] = useState<string | null>(null);
  const [executingResult, setExecutingResult] = useState<{
    skillName: string;
    output: string;
  } | null>(null);
  const currentSessionId = useChatStore((s) => s.currentSessionId);

  const loadSkills = useCallback(async () => {
    try {
      const data = await api.listSkills();
      setSkills(data.skills);
    } catch {
      // Endpoint may not exist
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const openModal = (skillId: string) => {
    setModalSkillId(skillId);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalSkillId(null);
  };

  const handleExecute = async (variables: Record<string, string>) => {
    if (!modalSkillId) return;
    const skill = skills.find((s) => s.id === modalSkillId);
    try {
      const result = await api.runSkill(
        currentSessionId ?? "",
        modalSkillId,
        variables
      );
      setExecutingResult({ skillName: skill?.name ?? "", output: result.output });
      success("技能执行成功");
    } catch (err) {
      error("执行失败: " + String(err));
    }
    closeModal();
  };

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-tertiary)",
        }}
      >
        <Loader2
          size={24}
          style={{ animation: "spin 1s linear infinite" }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        {/* Execution result banner */}
        {executingResult && (
          <div
            style={{
              padding: "var(--space-3) var(--space-4)",
              background: "var(--success-light)",
              border: "1px solid var(--success)",
              borderRadius: "var(--radius-lg)",
            }}
          >
            <p
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: ("var(--font-medium)" as unknown as number),
                color: "var(--success)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <CheckCircle size={16} />
              {executingResult.skillName} 执行成功
            </p>
            <pre
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                marginTop: "var(--space-2)",
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflowY: "auto",
                margin: 0,
              }}
            >
              {executingResult.output}
            </pre>
          </div>
        )}

        {skills.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-12) var(--space-6)",
              background: "var(--bg-secondary)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--border-primary)",
            }}
          >
            <Package
              size={40}
              style={{
                color: "var(--text-tertiary)",
                marginBottom: "var(--space-3)",
              }}
            />
            <p style={{ color: "var(--text-tertiary)" }}>暂无可用技能</p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "var(--space-4)",
            }}
          >
            {skills.map((skill) => (
              <div
                key={skill.id}
                style={{
                  padding: "var(--space-4) var(--space-5)",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-sm)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Header row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: "var(--space-2)",
                  }}
                >
                  <h4
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: ("var(--font-medium)" as unknown as number),
                      color: "var(--text-primary)",
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      margin: 0,
                    }}
                  >
                    <Zap size={14} style={{ color: "var(--interactive)" }} />
                    {skill.name}
                  </h4>
                  {skill.variables && skill.variables.length > 0 && (
                    <span
                      style={{
                        fontSize: "10px",
                        background: "var(--interactive-light)",
                        color: "var(--interactive)",
                        padding: "2px 6px",
                        borderRadius: "var(--radius-sm)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "2px",
                      }}
                    >
                      <Variable size={10} />
                      {skill.variables.length} 参数
                    </span>
                  )}
                </div>

                {/* Description */}
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-secondary)",
                    marginBottom: "var(--space-3)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    margin: "0 0 var(--space-3) 0",
                  }}
                >
                  {skill.description}
                </p>

                {/* Tool tags */}
                {skill.tools.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "var(--space-1)",
                      marginBottom: "var(--space-3)",
                    }}
                  >
                    {skill.tools.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: "10px",
                          padding: "2px 6px",
                          background: "var(--bg-tertiary)",
                          color: "var(--text-tertiary)",
                          borderRadius: "var(--radius-sm)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "2px",
                        }}
                      >
                        <Wrench size={9} />
                        {t}
                      </span>
                    ))}
                    {skill.tools.length > 3 && (
                      <span
                        style={{
                          fontSize: "10px",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        +{skill.tools.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* Execute button */}
                <button
                  onClick={() => openModal(skill.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-2) var(--space-3)",
                    background: "var(--interactive)",
                    color: "#fff",
                    fontSize: "var(--text-xs)",
                    border: "none",
                    borderRadius: "var(--radius-lg)",
                    cursor: "pointer",
                    transition: "var(--transition-fast)",
                    marginTop: "auto",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.filter =
                      "brightness(1.1)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.filter =
                      "none";
                  }}
                >
                  <Play size={14} />
                  执行
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skill Execution Modal */}
      {modalOpen && modalSkillId && (
        <SkillExecuteModal
          skillId={modalSkillId}
          skills={skills}
          sessionId={currentSessionId}
          onExecute={handleExecute}
          onClose={closeModal}
        />
      )}
    </>
  );
}

// =============================================================================
// SkillExecuteModal - inline modal for variable input
// =============================================================================

function SkillExecuteModal({
  skillId,
  skills,
  sessionId,
  onExecute,
  onClose,
}: {
  skillId: string;
  skills: SkillInfo[];
  sessionId: string | null;
  onExecute: (vars: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const skill = skills.find((s) => s.id === skillId);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);

  if (!skill) return null;

  const handleExecute = async () => {
    setExecuting(true);
    await onExecute(vars);
    setExecuting(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-primary)",
          borderRadius: "var(--radius-xl)",
          padding: "var(--space-6)",
          width: "100%",
          maxWidth: 440,
          margin: "0 var(--space-4)",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--space-4)",
          }}
        >
          <h3
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: ("var(--font-medium)" as unknown as number),
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              margin: 0,
            }}
          >
            <Zap size={16} style={{ color: "var(--interactive)" }} />
            执行技能: {skill.name}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-tertiary)",
              padding: "var(--space-1)",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--text-primary)";
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--text-tertiary)";
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Variables or info */}
        {skill.variables && skill.variables.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              marginBottom: "var(--space-4)",
            }}
          >
            {skill.variables.map((v: SkillVariableInfo) => (
              <div key={v.name}>
                <label
                  style={{
                    display: "block",
                    fontSize: "var(--text-xs)",
                    fontWeight: ("var(--font-medium)" as unknown as number),
                    color: "var(--text-secondary)",
                    marginBottom: "var(--space-1)",
                  }}
                >
                  {v.description || v.name}
                  {v.required && (
                    <span style={{ color: "var(--error)", marginLeft: 4 }}>
                      *
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={vars[v.name] ?? v.defaultValue ?? ""}
                  onChange={(e) =>
                    setVars((prev) => ({ ...prev, [v.name]: e.target.value }))
                  }
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-lg)",
                    fontSize: "var(--text-sm)",
                    color: "var(--text-primary)",
                    outline: "none",
                    transition: "var(--transition-fast)",
                    boxSizing: "border-box",
                  }}
                  onFocus={(e) => {
                    (e.target as HTMLInputElement).style.borderColor =
                      "var(--interactive)";
                    (e.target as HTMLInputElement).style.boxShadow =
                      "0 0 0 2px var(--interactive-light)";
                  }}
                  onBlur={(e) => {
                    (e.target as HTMLInputElement).style.borderColor =
                      "var(--border-primary)";
                    (e.target as HTMLInputElement).style.boxShadow = "none";
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-tertiary)",
              marginBottom: "var(--space-4)",
            }}
          >
            此技能无需参数
          </p>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-2)",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "var(--space-2) var(--space-4)",
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              background: "transparent",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-lg)",
              cursor: "pointer",
              transition: "var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--bg-hover)";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--text-secondary)";
            }}
          >
            取消
          </button>
          <button
            onClick={handleExecute}
            disabled={executing || !sessionId}
            style={{
              padding: "var(--space-2) var(--space-4)",
              background: "var(--interactive)",
              color: "#fff",
              fontSize: "var(--text-sm)",
              border: "none",
              borderRadius: "var(--radius-lg)",
              cursor: executing || !sessionId ? "not-allowed" : "pointer",
              opacity: executing || !sessionId ? 0.5 : 1,
              transition: "var(--transition-fast)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
            onMouseEnter={(e) => {
              if (!executing && sessionId) {
                (e.currentTarget as HTMLButtonElement).style.filter =
                  "brightness(1.1)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.filter = "none";
            }}
          >
            {executing ? (
              <>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                执行中...
              </>
            ) : (
              <>
                <Play size={14} />
                执行
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
