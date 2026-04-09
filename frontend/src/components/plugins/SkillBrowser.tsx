// =============================================================================
// DeepAnalyze - SkillBrowser Component
// Browse and execute skills
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useChatStore } from "../../store/chat";
import { useToast } from "../../hooks/useToast";
import type { SkillInfo, SkillVariableInfo } from "../../types/index";

export function SkillBrowser() {
  const { success, error } = useToast();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [executingSkill, setExecutingSkill] = useState<string | null>(null);
  const [executingResult, setExecutingResult] = useState<{ skillName: string; output: string } | null>(null);
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

  useEffect(() => { loadSkills(); }, [loadSkills]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-da-text-muted">
        <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-da-text">技能库</h2>
          <p className="text-sm text-da-text-secondary mt-1">浏览和执行可用技能</p>
        </div>

        {executingResult && (
          <div className="px-4 py-3 bg-da-green/10 border border-da-green/20 rounded-lg">
            <p className="text-sm text-da-green font-medium">{executingResult.skillName} 执行成功</p>
            <pre className="text-xs text-da-text-secondary mt-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {executingResult.output}
            </pre>
          </div>
        )}

        {skills.length === 0 ? (
          <div className="text-center py-12 bg-da-surface rounded-xl border border-da-border">
            <p className="text-da-text-muted">暂无可用技能</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {skills.map((skill) => (
              <div key={skill.id} className="px-5 py-4 bg-da-surface border border-da-border rounded-lg">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-medium text-da-text">{skill.name}</h4>
                  {skill.variables && skill.variables.length > 0 && (
                    <span className="text-[10px] bg-da-accent/10 text-da-accent px-1.5 py-0.5 rounded">
                      {skill.variables.length} 参数
                    </span>
                  )}
                </div>
                <p className="text-xs text-da-text-secondary mb-3 line-clamp-2">{skill.description}</p>
                {skill.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {skill.tools.slice(0, 3).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 bg-da-bg-tertiary text-da-text-muted rounded">
                        {t}
                      </span>
                    ))}
                    {skill.tools.length > 3 && (
                      <span className="text-[10px] text-da-text-muted">+{skill.tools.length - 3}</span>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setExecutingSkill(skill.id)}
                  className="px-3 py-1.5 bg-da-accent hover:bg-da-accent-hover text-white text-xs rounded-lg cursor-pointer transition-colors"
                >
                  执行
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Skill Execution Modal */}
        {executingSkill && (
          <SkillExecuteModal
            skillId={executingSkill}
            skills={skills}
            sessionId={currentSessionId}
            onExecute={async (variables) => {
              const skill = skills.find((s) => s.id === executingSkill);
              try {
                const result = await api.runSkill(currentSessionId ?? "", executingSkill, variables);
                setExecutingResult({ skillName: skill?.name ?? "", output: result.output });
                success("技能执行成功");
              } catch (err) {
                error("执行失败: " + String(err));
              }
              setExecutingSkill(null);
            }}
            onClose={() => setExecutingSkill(null)}
          />
        )}
      </div>
    </div>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-da-bg-secondary border border-da-border rounded-xl p-6 w-full max-w-md mx-4">
        <h3 className="text-sm font-medium text-da-text mb-4">执行技能: {skill.name}</h3>

        {skill.variables && skill.variables.length > 0 ? (
          <div className="space-y-3 mb-4">
            {skill.variables.map((v) => (
              <div key={v.name}>
                <label className="block text-xs font-medium text-da-text-secondary mb-1">
                  {v.description || v.name}
                  {v.required && <span className="text-da-red ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={vars[v.name] ?? v.defaultValue ?? ""}
                  onChange={(e) => setVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  className="w-full px-3 py-2 bg-da-bg border border-da-border rounded-lg text-sm text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent/30"
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-da-text-muted mb-4">此技能无需参数</p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-da-text-secondary hover:text-da-text cursor-pointer">取消</button>
          <button
            onClick={handleExecute}
            disabled={executing || !sessionId}
            className="px-4 py-2 bg-da-accent hover:bg-da-accent-hover text-white text-sm rounded-lg cursor-pointer disabled:opacity-50 transition-colors"
          >
            {executing ? "执行中..." : "执行"}
          </button>
        </div>
      </div>
    </div>
  );
}
