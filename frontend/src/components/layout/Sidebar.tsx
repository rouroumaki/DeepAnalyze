import {
  MessageSquare,
  BookOpen,
  FileBarChart,
  ListTodo,
  ChevronLeft,
  ChevronRight,
  Plus,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { useUIStore, type ViewId } from '../../store/ui';
import { useChatStore } from '../../store/chat';
import { useState, useEffect } from 'react';

interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
}

const mainNavItems: NavItem[] = [
  { id: 'chat', label: '对话', icon: <MessageSquare size={18} /> },
  { id: 'knowledge', label: '知识库', icon: <BookOpen size={18} /> },
  { id: 'reports', label: '报告', icon: <FileBarChart size={18} /> },
  { id: 'tasks', label: '任务', icon: <ListTodo size={18} /> },
];

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const currentKbId = useUIStore((s) => s.currentKbId);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);

  // Chat store for session management
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const createSession = useChatStore((s) => s.createSession);

  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const width = collapsed
    ? 'var(--sidebar-collapsed-width)'
    : 'var(--sidebar-width)';

  const handleNewChat = async () => {
    window.location.hash = '#/chat';
    await createSession();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && !collapsed && (
        <div
          onClick={toggleSidebar}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 'var(--z-overlay)',
          }}
        />
      )}
      <aside
        style={{
          width: isMobile ? (collapsed ? 0 : 260) : width,
          minWidth: isMobile ? 0 : width,
          height: '100%',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-primary)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width var(--transition-slow), min-width var(--transition-slow)',
          overflow: 'hidden',
          position: isMobile && !collapsed ? 'fixed' as const : 'relative' as const,
          top: isMobile && !collapsed ? 'var(--header-height)' as const : undefined,
          left: isMobile && !collapsed ? 0 : undefined,
          bottom: isMobile && !collapsed ? 0 : undefined,
          zIndex: isMobile && !collapsed ? 'var(--z-sticky)' as const : undefined,
          boxShadow: isMobile && !collapsed ? 'var(--shadow-2xl)' as const : undefined,
        }}
      >
      {/* New Chat Button */}
      <div style={{ padding: collapsed ? 'var(--space-2)' : 'var(--space-3)' }}>
        <button
          title="新建对话"
          onClick={handleNewChat}
          style={{
            width: '100%',
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            border: '1px dashed var(--border-secondary)',
            borderRadius: 'var(--radius-lg)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            transition: 'all var(--transition-fast)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--interactive)';
            e.currentTarget.style.color = 'var(--interactive)';
            e.currentTarget.style.background = 'var(--interactive-light)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-secondary)';
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Plus size={16} style={{ flexShrink: 0 }} />
          {!collapsed && <span>新建对话</span>}
        </button>
      </div>

      {/* Session List - only show when chat view is active */}
      {!collapsed && activeView === 'chat' && sessions.length > 0 && (
        <div style={{ padding: '0 var(--space-3)', flexShrink: 0 }}>
          <div
            onClick={() => setSessionsExpanded(!sessionsExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-1) var(--space-1)',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.05em',
              userSelect: 'none',
            }}
          >
            <span>会话历史</span>
            <ChevronDown
              size={12}
              style={{
                transform: sessionsExpanded ? 'rotate(0)' : 'rotate(-90deg)',
                transition: 'transform var(--transition-fast)',
              }}
            />
          </div>
          {sessionsExpanded && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                maxHeight: 200,
                overflowY: 'auto',
                marginBottom: 'var(--space-2)',
              }}
            >
              {sessions.slice(0, 10).map((session) => {
                const isActive = session.id === currentSessionId;
                const isHovered = session.id === hoveredSession;
                return (
                  <div
                    key={session.id}
                    onClick={() => {
                      selectSession(session.id);
                      window.location.hash = "#/sessions/" + session.id;
                    }}
                    onMouseEnter={() => setHoveredSession(session.id)}
                    onMouseLeave={() => setHoveredSession(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-xs)',
                      color: isActive ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      background: isActive ? 'var(--brand-light)' : 'transparent',
                      transition: 'all var(--transition-fast)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {isActive && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 4,
                          bottom: 4,
                          width: 2,
                          borderRadius: '0 2px 2px 0',
                          background: 'var(--brand-primary)',
                        }}
                      />
                    )}
                    <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {session.title || '新对话'}
                    </span>
                    {isHovered && !isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(session.id);
                        }}
                        title="删除会话"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 2,
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          background: 'transparent',
                          color: 'var(--text-tertiary)',
                          cursor: 'pointer',
                          flexShrink: 0,
                          transition: 'color var(--transition-fast)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--error)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--text-tertiary)';
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Nav Items */}
      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: `0 ${collapsed ? 'var(--space-2)' : 'var(--space-2)'}`,
        }}
      >
        {/* Workspace section header */}
        {!collapsed && (
          <div
            onClick={() => setProjectsExpanded(!projectsExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-2) var(--space-2)',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.05em',
              userSelect: 'none',
            }}
          >
            <span>工作区</span>
            <ChevronDown
              size={12}
              style={{
                transform: projectsExpanded ? 'rotate(0)' : 'rotate(-90deg)',
                transition: 'transform var(--transition-fast)',
              }}
            />
          </div>
        )}

        {mainNavItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={activeView === item.id}
            collapsed={collapsed}
            onClick={() => {
              // Knowledge needs a kbId; if none available, go to chat
              if (item.id === 'knowledge') {
                if (currentKbId) {
                  setActiveView('knowledge');
                  window.location.hash = `#/knowledge/${currentKbId}`;
                } else {
                  // No KB selected yet — redirect to chat where user can create one
                  setActiveView('chat');
                  window.location.hash = '#/chat';
                }
              } else {
                setActiveView(item.id);
                window.location.hash = `#/${item.id}`;
              }
            }}
          />
        ))}
      </nav>

      {/* Collapse Toggle */}
      <button
        onClick={toggleSidebar}
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        style={{
          position: 'absolute',
          right: -12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 24,
          height: 24,
          borderRadius: 'var(--radius-full)',
          border: '1px solid var(--border-primary)',
          background: 'var(--bg-primary)',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
          transition: 'all var(--transition-fast)',
          boxShadow: 'var(--shadow-sm)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.borderColor = 'var(--interactive)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-tertiary)';
          e.currentTarget.style.borderColor = 'var(--border-primary)';
        }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
    </>
  );
}

function NavButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: collapsed
          ? '8px'
          : '8px var(--space-3)',
        justifyContent: collapsed ? 'center' : 'flex-start',
        border: 'none',
        borderRadius: 'var(--radius-lg)',
        background: active ? 'var(--brand-light)' : 'transparent',
        color: active ? 'var(--brand-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 'var(--text-sm)',
        fontWeight: active ? 500 : 400,
        transition: 'all var(--transition-fast)',
        marginBottom: 2,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--bg-hover)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }
      }}
    >
      {/* Active indicator bar */}
      {active && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: '0 3px 3px 0',
            background: 'var(--brand-primary)',
          }}
        />
      )}
      <span style={{ flexShrink: 0, display: 'flex' }}>{item.icon}</span>
      {!collapsed && <span>{item.label}</span>}
    </button>
  );
}
