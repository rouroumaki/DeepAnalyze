// =============================================================================
// DeepAnalyze - PluginManager Component
// Plugin management with tabs: installed plugins + skill browser
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { SkillBrowser } from "./SkillBrowser";
import type { PluginInfo } from "../../types/index";
import {
  Puzzle,
  ToggleLeft,
  ToggleRight,
  Trash2,
  RefreshCw,
  Package,
} from "lucide-react";

type TabKey = "installed" | "skills";

const tabLabels: { key: TabKey; label: string }[] = [
  { key: "installed", label: "已安装" },
  { key: "skills", label: "技能库" },
];

export function PluginManager() {
  const { success, error } = useToast();
  const confirm = useConfirm();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("installed");

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

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

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
    const ok = await confirm({
      title: "删除插件",
      message: "确定要删除此插件吗？此操作不可撤销。",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await api.deletePlugin(id);
      success("插件已删除");
      await loadPlugins();
    } catch {
      error("删除失败");
    }
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
        <RefreshCw
          size={24}
          style={{ animation: "spin 1s linear infinite" }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "var(--space-6)",
      }}
    >
      <div
        style={{
          maxWidth: "48rem",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        {/* Header */}
        <div>
          <h2
            style={{
              fontSize: "var(--text-base)",
              fontWeight: "var(--font-semibold)" as unknown as number,
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <Puzzle size={20} />
            插件管理
          </h2>
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              marginTop: "var(--space-1)",
            }}
          >
            管理已安装的场景插件和工具扩展
          </p>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-1)",
            borderBottom: "1px solid var(--border-primary)",
          }}
        >
          {tabLabels.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  fontSize: "var(--text-sm)",
                  fontWeight: isActive
                    ? ("var(--font-semibold)" as unknown as number)
                    : ("var(--font-medium)" as unknown as number),
                  color: isActive
                    ? "var(--interactive)"
                    : "var(--text-secondary)",
                  background: "transparent",
                  border: "none",
                  borderBottom: isActive
                    ? "2px solid var(--interactive)"
                    : "2px solid transparent",
                  cursor: "pointer",
                  transition: "var(--transition-fast)",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === "skills" ? (
          <SkillBrowser />
        ) : (
          <>
            {/* Refresh button */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={loadPlugins}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-2) var(--space-3)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  transition: "var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--bg-secondary)";
                }}
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </div>

            {plugins.length === 0 ? (
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
                <p style={{ color: "var(--text-tertiary)" }}>
                  暂无已安装的插件
                </p>
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    marginTop: "var(--space-1)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  将插件放入 plugins/ 目录后重启系统
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-3)",
                }}
              >
                {plugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    style={{
                      padding: "var(--space-4) var(--space-5)",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-lg)",
                      boxShadow: "var(--shadow-sm)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                      }}
                    >
                      {/* Left side: plugin info */}
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-2)",
                          }}
                        >
                          <p
                            style={{
                              fontSize: "var(--text-sm)",
                              fontWeight:
                                "var(--font-medium)" as unknown as number,
                              color: "var(--text-primary)",
                            }}
                          >
                            {plugin.name}
                          </p>
                          <span
                            style={{
                              fontSize: "10px",
                              color: "var(--text-tertiary)",
                              background: "var(--bg-tertiary)",
                              padding: "2px 6px",
                              borderRadius: "var(--radius-sm)",
                            }}
                          >
                            v{plugin.version}
                          </span>
                          {plugin.error && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "var(--error)",
                                background: "var(--error-light)",
                                padding: "2px 6px",
                                borderRadius: "var(--radius-sm)",
                              }}
                            >
                              错误
                            </span>
                          )}
                        </div>
                        <p
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--text-secondary)",
                            marginTop: "var(--space-1)",
                          }}
                        >
                          {plugin.description}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-3)",
                            marginTop: "var(--space-2)",
                            fontSize: "10px",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {plugin.author && <span>作者: {plugin.author}</span>}
                          {plugin.toolNames.length > 0 && (
                            <span>{plugin.toolNames.length} 工具</span>
                          )}
                          {plugin.agentTypes.length > 0 && (
                            <span>{plugin.agentTypes.length} Agent</span>
                          )}
                        </div>
                      </div>

                      {/* Right side: actions */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          flexShrink: 0,
                          marginLeft: "var(--space-4)",
                        }}
                      >
                        {/* Toggle switch */}
                        <button
                          onClick={() => handleToggle(plugin)}
                          style={{
                            position: "relative",
                            width: 40,
                            height: 20,
                            borderRadius: 10,
                            border: "none",
                            cursor: "pointer",
                            transition: "var(--transition-fast)",
                            background: plugin.enabled
                              ? "var(--interactive)"
                              : "var(--border-primary)",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: 2,
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              background: "#fff",
                              transition: "var(--transition-fast)",
                              transform: plugin.enabled
                                ? "translateX(20px)"
                                : "translateX(2px)",
                            }}
                          />
                        </button>
                        {/* Toggle icon indicator */}
                        {plugin.enabled ? (
                          <ToggleRight
                            size={16}
                            style={{ color: "var(--success)" }}
                          />
                        ) : (
                          <ToggleLeft
                            size={16}
                            style={{ color: "var(--text-tertiary)" }}
                          />
                        )}
                        {/* Delete button */}
                        <button
                          onClick={() => handleDelete(plugin.id)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "var(--space-1)",
                            color: "var(--text-tertiary)",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "var(--text-xs)",
                            padding: "var(--space-1)",
                            borderRadius: "var(--radius-sm)",
                            transition: "var(--transition-fast)",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color =
                              "var(--error)";
                            (e.currentTarget as HTMLButtonElement).style.background =
                              "var(--error-light)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color =
                              "var(--text-tertiary)";
                            (e.currentTarget as HTMLButtonElement).style.background =
                              "transparent";
                          }}
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
