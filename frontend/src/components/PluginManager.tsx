import { useState, useEffect, useCallback } from "react";
import { api, type PluginInfo } from "../api/client";

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 ${
        checked ? "bg-blue-600" : "bg-gray-300"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
          checked ? "translate-x-4.5 ml-0.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteConfirmDialog({
  pluginName,
  onConfirm,
  onCancel,
}: {
  pluginName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-2">
          确认删除插件
        </h3>
        <p className="text-sm text-gray-500 mb-6">
          确定要删除插件 <span className="font-medium text-gray-700">"{pluginName}"</span> 吗？此操作不可撤销。
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors cursor-pointer"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PluginManager (main component)
// ---------------------------------------------------------------------------

export function PluginManager() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PluginInfo | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPlugins = useCallback(() => {
    setIsLoading(true);
    setError(null);
    api
      .listPlugins()
      .then((data) => setPlugins(data.plugins ?? []))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载插件列表失败"),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const handleToggle = async (plugin: PluginInfo) => {
    setTogglingId(plugin.id);
    try {
      if (plugin.enabled) {
        await api.disablePlugin(plugin.id);
      } else {
        await api.enablePlugin(plugin.id);
      }
      // Refresh the list
      const data = await api.listPlugins();
      setPlugins(data.plugins ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await api.deletePlugin(deleteTarget.id);
      setPlugins((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
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
          加载插件列表...
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
            onClick={() => {
              setError(null);
              fetchPlugins();
            }}
            className="text-xs text-blue-500 hover:text-blue-600 cursor-pointer"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (plugins.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        暂无已安装插件
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-3">
        {plugins.map((plugin) => {
          const isToggling = togglingId === plugin.id;
          const isDeleting = deletingId === plugin.id;

          return (
            <div
              key={plugin.id}
              className={`bg-white rounded-xl border p-4 transition-all duration-150 ${
                plugin.error
                  ? "border-red-200"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              {/* Top row: name + controls */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-gray-800">
                      {plugin.name}
                    </h4>
                    <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                      v{plugin.version}
                    </span>
                    {plugin.author && (
                      <span className="text-xs text-gray-400">
                        by {plugin.author}
                      </span>
                    )}
                    {plugin.error && (
                      <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded">
                        错误
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {plugin.description}
                  </p>
                </div>

                {/* Controls */}
                <div className="shrink-0 flex items-center gap-3">
                  <ToggleSwitch
                    checked={plugin.enabled}
                    onChange={() => handleToggle(plugin)}
                    disabled={isToggling}
                  />
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(plugin)}
                    disabled={isDeleting}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                    title="删除插件"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Badges row */}
              <div className="flex items-center gap-2 mt-2">
                {plugin.toolNames.length > 0 && (
                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {plugin.toolNames.length} 个工具
                  </span>
                )}
                {plugin.agentTypes.length > 0 && (
                  <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                    {plugin.agentTypes.length} 种代理
                  </span>
                )}
                {!plugin.enabled && (
                  <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                    已禁用
                  </span>
                )}
              </div>

              {/* Error detail */}
              {plugin.error && (
                <div className="mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-xs text-red-600">{plugin.error}</p>
                </div>
              )}

              {/* Loaded time */}
              <p className="text-xs text-gray-300 mt-2">
                加载于 {new Date(plugin.loadedAt).toLocaleString("zh-CN")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <DeleteConfirmDialog
          pluginName={deleteTarget.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
