// =============================================================================
// DeepAnalyze - PluginManager Component
// Plugin management with tabs: installed plugins + skill browser
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { SkillBrowser } from "./SkillBrowser";
import { Spinner } from "../ui/Spinner";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Tabs } from "../ui/Tabs";
import type { PluginInfo } from "../../types/index";
import {
  Puzzle,
  Trash2,
  RefreshCw,
  Package,
  AlertCircle,
  Wrench,
  Bot,
} from "lucide-react";

type TabKey = "installed" | "skills";

const tabItems: { key: string; label: string }[] = [
  { key: "installed", label: "\u5DF2\u5B89\u88C5" },
  { key: "skills", label: "\u6280\u80FD\u5E93" },
];

export function PluginManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("installed");

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.listPlugins();
      setPlugins(data);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load plugins"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const handleToggle = async (plugin: PluginInfo) => {
    setTogglingId(plugin.id);
    try {
      if (plugin.enabled) {
        await api.disablePlugin(plugin.id);
        success(`${plugin.name} \u5DF2\u7981\u7528`);
      } else {
        await api.enablePlugin(plugin.id);
        success(`${plugin.name} \u5DF2\u542F\u7528`);
      }
      await loadPlugins();
    } catch {
      toastError("\u64CD\u4F5C\u5931\u8D25");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "\u5220\u9664\u63D2\u4EF6",
      message: "\u786E\u5B9A\u8981\u5220\u9664\u6B64\u63D2\u4EF6\u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
      variant: "danger",
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      await api.deletePlugin(id);
      success("\u63D2\u4EF6\u5DF2\u5220\u9664");
      await loadPlugins();
    } catch {
      toastError("\u5220\u9664\u5931\u8D25");
    } finally {
      setDeletingId(null);
    }
  };

  // ===========================================================================
  // Loading state
  // ===========================================================================
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.centerContainer}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // ===========================================================================
  // Main render
  // ===========================================================================
  return (
    <div style={styles.page}>
      <div style={styles.content}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>
              <Puzzle size={20} />
              {"\u63D2\u4EF6\u7BA1\u7406"}
            </h2>
            <p style={styles.subtitle}>
              {"\u7BA1\u7406\u5DF2\u5B89\u88C5\u7684\u573A\u666F\u63D2\u4EF6\u548C\u5DE5\u5177\u6269\u5C55"}
            </p>
          </div>
          {activeTab === "installed" && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={loadPlugins}
            >
              {"\u5237\u65B0"}
            </Button>
          )}
        </div>

        {/* Tabs */}
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
        />

        {/* Tab Content */}
        <div style={styles.tabContent}>
          {activeTab === "skills" ? (
            <SkillBrowser />
          ) : (
            <>
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
                    onClick={loadPlugins}
                    style={{ marginLeft: "auto", flexShrink: 0 }}
                  >
                    {"\u91CD\u8BD5"}
                  </Button>
                </div>
              )}

              {/* Empty state */}
              {!loadError && plugins.length === 0 ? (
                <EmptyState
                  icon={<Package size={24} />}
                  title={"\u6682\u65E0\u5DF2\u5B89\u88C5\u7684\u63D2\u4EF6"}
                  description={
                    "\u5C06\u63D2\u4EF6\u653E\u5165 plugins/ \u76EE\u5F55\u540E\u91CD\u542F\u7CFB\u7EDF\u5373\u53EF\u4F7F\u7528"
                  }
                  actionLabel={"\u5237\u65B0"}
                  onAction={loadPlugins}
                />
              ) : (
                <div style={styles.pluginList}>
                  {plugins.map((plugin) => (
                    <PluginCard
                      key={plugin.id}
                      plugin={plugin}
                      toggling={togglingId === plugin.id}
                      deleting={deletingId === plugin.id}
                      onToggle={() => handleToggle(plugin)}
                      onDelete={() => handleDelete(plugin.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PluginCard - individual plugin row
// =============================================================================

function PluginCard({
  plugin,
  toggling,
  deleting,
  onToggle,
  onDelete,
}: {
  plugin: PluginInfo;
  toggling: boolean;
  deleting: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.cardBody}>
        {/* Left side: plugin info */}
        <div style={styles.cardInfo}>
          {/* Name + badges row */}
          <div style={styles.cardTitleRow}>
            <span style={styles.cardName}>{plugin.name}</span>
            <Badge variant="default" size="sm">
              {"v" + plugin.version}
            </Badge>
            {plugin.enabled ? (
              <Badge variant="success" size="sm">
                {"\u5DF2\u542F\u7528"}
              </Badge>
            ) : (
              <Badge variant="default" size="sm">
                {"\u5DF2\u7981\u7528"}
              </Badge>
            )}
            {plugin.error && (
              <Badge variant="error" size="sm">
                {"\u52A0\u8F7D\u9519\u8BEF"}
              </Badge>
            )}
          </div>

          {/* Description */}
          <p style={styles.cardDescription}>{plugin.description}</p>

          {/* Meta row */}
          <div style={styles.cardMeta}>
            {plugin.author && (
              <span style={styles.metaItem}>
                {"\u4F5C\u8005: " + plugin.author}
              </span>
            )}
            {plugin.toolNames.length > 0 && (
              <span style={styles.metaItem}>
                <Wrench size={10} style={{ marginRight: 4 }} />
                {plugin.toolNames.length + " \u5DE5\u5177"}
              </span>
            )}
            {plugin.agentTypes.length > 0 && (
              <span style={styles.metaItem}>
                <Bot size={10} style={{ marginRight: 4 }} />
                {plugin.agentTypes.length + " Agent"}
              </span>
            )}
          </div>
        </div>

        {/* Right side: actions */}
        <div style={styles.cardActions}>
          {toggling ? (
            <Spinner size="sm" />
          ) : (
            <ToggleSwitch
              checked={plugin.enabled}
              onChange={onToggle}
              size="sm"
              aria-label={
                plugin.enabled
                  ? "\u7981\u7528 " + plugin.name
                  : "\u542F\u7528 " + plugin.name
              }
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={
              deleting ? <Spinner size="sm" color="currentColor" /> : <Trash2 size={14} />
            }
            onClick={onDelete}
            disabled={deleting}
            style={
              deleting
                ? undefined
                : {
                    color: "var(--text-tertiary)",
                  }
            }
          >
            {"\u5220\u9664"}
          </Button>
        </div>
      </div>

      {/* Error detail */}
      {plugin.error && (
        <div style={styles.cardError}>
          <AlertCircle size={12} />
          <span>{plugin.error}</span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: "100%",
    overflowY: "auto",
    padding: "var(--space-6)",
  },
  content: {
    maxWidth: "48rem",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
  },
  centerContainer: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  title: {
    fontSize: "var(--text-base)",
    fontWeight: "var(--font-semibold)" as unknown as number,
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    margin: 0,
  },
  subtitle: {
    fontSize: "var(--text-sm)",
    color: "var(--text-secondary)",
    marginTop: "var(--space-1)",
    margin: 0,
    paddingTop: "var(--space-1)",
  },
  tabContent: {
    minHeight: 0,
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--error-light)",
    border: "1px solid var(--error)",
    borderRadius: "var(--radius-lg)",
    color: "var(--error-dark)",
    marginBottom: "var(--space-4)",
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
  pluginList: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  card: {
    padding: "var(--space-4) var(--space-5)",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-primary)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-sm)",
  },
  cardBody: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flexWrap: "wrap" as const,
  },
  cardName: {
    fontSize: "var(--text-sm)",
    fontWeight: "var(--font-medium)" as unknown as number,
    color: "var(--text-primary)",
  },
  cardDescription: {
    fontSize: "var(--text-xs)",
    color: "var(--text-secondary)",
    marginTop: "var(--space-1)",
    marginBottom: 0,
    lineHeight: "var(--leading-relaxed)" as unknown as number,
  },
  cardMeta: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    marginTop: "var(--space-2)",
    fontSize: "var(--text-xs)",
    color: "var(--text-tertiary)",
  },
  metaItem: {
    display: "inline-flex",
    alignItems: "center",
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    flexShrink: 0,
    marginLeft: "var(--space-4)",
  },
  cardError: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-1)",
    marginTop: "var(--space-2)",
    padding: "var(--space-2) var(--space-3)",
    fontSize: "var(--text-xs)",
    color: "var(--error)",
    background: "var(--error-light)",
    borderRadius: "var(--radius-sm)",
  },
};
