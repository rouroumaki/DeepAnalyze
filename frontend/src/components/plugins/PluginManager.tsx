// =============================================================================
// DeepAnalyze - PluginManager Component
// Plugin management with enable/disable/delete
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import type { PluginInfo } from "../../types/index";

export function PluginManager() {
  const { success, error } = useToast();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPlugins = useCallback(async () => {
    try {
      const data = await api.listPlugins();
      setPlugins(data.plugins);
    } catch {
      // Endpoint may not exist
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlugins(); }, [loadPlugins]);

  const handleToggle = async (plugin: PluginInfo) => {
    try {
      if (plugin.enabled) {
        await api.disablePlugin(plugin.id);
        success(`${plugin.name} 已禁用`);
      } else {
        await api.enablePlugin(plugin.id);
        success(`${plugin.name} 已启用`);
      }
      await loadPlugins();
    } catch {
      error("操作失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此插件?")) return;
    try {
      await api.deletePlugin(id);
      success("插件已删除");
      await loadPlugins();
    } catch {
      error("删除失败");
    }
  };

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
          <h2 className="text-lg font-semibold text-da-text">插件管理</h2>
          <p className="text-sm text-da-text-secondary mt-1">管理已安装的场景插件和工具扩展</p>
        </div>

        {plugins.length === 0 ? (
          <div className="text-center py-12 bg-da-surface rounded-xl border border-da-border">
            <p className="text-da-text-muted">暂无已安装的插件</p>
            <p className="text-xs mt-1">将插件放入 plugins/ 目录后重启系统</p>
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="px-5 py-4 bg-da-surface border border-da-border rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-da-text">{plugin.name}</p>
                      <span className="text-[10px] text-da-text-muted bg-da-bg-tertiary px-1.5 py-0.5 rounded">
                        v{plugin.version}
                      </span>
                      {plugin.error && (
                        <span className="text-[10px] text-da-red bg-red-500/10 px-1.5 py-0.5 rounded">
                          错误
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-da-text-secondary mt-1">{plugin.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-da-text-muted">
                      {plugin.author && <span>作者: {plugin.author}</span>}
                      {plugin.toolNames.length > 0 && <span>{plugin.toolNames.length} 工具</span>}
                      {plugin.agentTypes.length > 0 && <span>{plugin.agentTypes.length} Agent</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <button
                      onClick={() => handleToggle(plugin)}
                      className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        plugin.enabled ? "bg-da-accent" : "bg-da-border"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          plugin.enabled ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleDelete(plugin.id)}
                      className="text-da-text-muted hover:text-da-red cursor-pointer text-xs"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
