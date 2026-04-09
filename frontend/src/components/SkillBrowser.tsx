import { useState, useEffect, useCallback } from "react";
import { api, type SkillInfo, type SkillVariableInfo } from "../api/client";
import { useChatStore } from "../store/chat";

// ---------------------------------------------------------------------------
// Skill variable input modal
// ---------------------------------------------------------------------------

interface SkillExecuteModalProps {
  skill: SkillInfo;
  onClose: () => void;
  onExecute: (variables: Record<string, string>) => Promise<void>;
}

function SkillExecuteModal({ skill, onClose, onExecute }: SkillExecuteModalProps) {
  const variables = skill.variables ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const v of variables) {
      initial[v.name] = v.defaultValue ?? "";
    }
    return initial;
  });
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required variables
    for (const v of variables) {
      if (v.required && !values[v.name]?.trim()) {
        setError(`请填写必填项: ${v.name}`);
        return;
      }
    }

    setIsRunning(true);
    setError(null);
    try {
      await onExecute(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "执行失败");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-800">
              {skill.name}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">{skill.description}</p>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {variables.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              此技能无需参数，点击执行即可
            </p>
          ) : (
            variables.map((v) => (
              <div key={v.name}>
                <label
                  htmlFor={`var-${v.name}`}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {v.name}
                  {v.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {v.description && (
                  <p className="text-xs text-gray-400 mb-1.5">{v.description}</p>
                )}
                <input
                  id={`var-${v.name}`}
                  type="text"
                  value={values[v.name]}
                  onChange={(e) => handleChange(v.name, e.target.value)}
                  placeholder={v.defaultValue ?? `请输入 ${v.name}...`}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                />
              </div>
            ))
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isRunning}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
          >
            {isRunning && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isRunning ? "执行中..." : "执行"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill execution result display
// ---------------------------------------------------------------------------

interface SkillResultProps {
  result: { taskId: string; output: string; skillName: string };
  onClose: () => void;
}

function SkillResult({ result, onClose }: SkillResultProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-green-700">
              {result.skillName} - 执行完成
            </span>
            <span className="text-xs text-gray-400">
              任务 ID: {result.taskId.slice(0, 8)}
            </span>
          </div>
          {result.output && (
            <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded-lg p-3 border border-green-100 max-h-60 overflow-y-auto">
              {result.output}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillBrowser (main component)
// ---------------------------------------------------------------------------

export function SkillBrowser() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<SkillInfo | null>(null);
  const [result, setResult] = useState<{ taskId: string; output: string; skillName: string } | null>(null);

  const currentSessionId = useChatStore((s) => s.currentSessionId);

  const fetchSkills = useCallback(() => {
    setIsLoading(true);
    setError(null);
    api
      .listSkills()
      .then((data) => setSkills(data.skills ?? []))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载技能列表失败"),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleExecute = async (variables: Record<string, string>) => {
    if (!currentSessionId || !activeSkill) return;

    const res = await api.runSkill(currentSessionId, activeSkill.id, variables);
    setResult(res);
    setActiveSkill(null);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          加载技能列表...
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 text-sm mb-2">{error}</p>
          <button
            type="button"
            onClick={fetchSkills}
            className="text-xs text-blue-500 hover:text-blue-600 cursor-pointer"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (skills.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        暂无可用技能
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Result banner */}
      {result && (
        <div className="mb-4">
          <SkillResult result={result} onClose={() => setResult(null)} />
        </div>
      )}

      {/* Skill cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {skills.map((skill) => {
          const varCount = skill.variables?.length ?? 0;
          return (
            <div
              key={skill.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all duration-150"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-gray-800 truncate">
                    {skill.name}
                  </h4>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    {skill.description}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {varCount > 0 && (
                    <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                      {varCount} 个参数
                    </span>
                  )}
                  {skill.pluginId && (
                    <span className="text-xs text-purple-500 bg-purple-50 px-2 py-0.5 rounded">
                      插件
                    </span>
                  )}
                </div>
              </div>

              {/* Tools tags */}
              {skill.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.tools.slice(0, 3).map((tool) => (
                    <span
                      key={tool}
                      className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded"
                    >
                      {tool}
                    </span>
                  ))}
                  {skill.tools.length > 3 && (
                    <span className="text-xs text-gray-400">
                      +{skill.tools.length - 3}
                    </span>
                  )}
                </div>
              )}

              {/* Execute button */}
              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setActiveSkill(skill)}
                  className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-600 rounded-lg transition-colors cursor-pointer"
                >
                  执行
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Execute modal */}
      {activeSkill && (
        <SkillExecuteModal
          skill={activeSkill}
          onClose={() => setActiveSkill(null)}
          onExecute={handleExecute}
        />
      )}
    </div>
  );
}
