// =============================================================================
// DeepAnalyze - RightPanel Component
// Right-side slide-out panel with overlay
// =============================================================================

import React, { useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useUIStore } from "../../store/ui";
import { X } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface RightPanelProps {
  children?: React.ReactNode;
}

// =============================================================================
// Component
// =============================================================================

export function RightPanel({ children }: RightPanelProps) {
  const { rightPanelOpen, closeRightPanel, rightPanelContent } = useUIStore();
  const panelRef = useRef<HTMLDivElement>(null);

  // --- Close on Escape ---
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRightPanel();
    },
    [closeRightPanel],
  );

  useEffect(() => {
    if (rightPanelOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [rightPanelOpen, handleKeyDown]);

  // --- Not open: render nothing ---
  if (!rightPanelOpen) return null;

  // =====================================================================
  // Render
  // =====================================================================

  const content = (
    <>
      {/* ================================================================ */}
      {/* Overlay                                                          */}
      {/* ================================================================ */}
      <div
        onClick={closeRightPanel}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          zIndex: "var(--z-overlay)" as unknown as number,
          animation: "rightPanelFadeIn var(--transition-base) ease-out",
        }}
      />

      {/* ================================================================ */}
      {/* Panel                                                            */}
      {/* ================================================================ */}
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          backgroundColor: "var(--bg-primary)",
          borderLeft: "1px solid var(--border-primary)",
          boxShadow: "var(--shadow-2xl)",
          zIndex: "var(--z-modal)" as unknown as number,
          display: "flex",
          flexDirection: "column",
          animation: "rightPanelSlideIn var(--transition-slow) ease-out",
        }}
      >
        {/* ---- Header ---- */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--border-primary)",
            backgroundColor: "var(--bg-secondary)",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "var(--text-base)",
              fontWeight: "var(--font-semibold)",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {rightPanelContent ?? ""}
          </h3>
          <button
            onClick={closeRightPanel}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-md)",
              border: "none",
              backgroundColor: "transparent",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              transition:
                "background-color var(--transition-fast), color var(--transition-fast)",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ---- Scrollable content area ---- */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "var(--space-4)",
          }}
        >
          {children}
        </div>
      </div>

      {/* Inline keyframes for panel animations */}
      <style>{`
        @keyframes rightPanelFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes rightPanelSlideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </>
  );

  return createPortal(content, document.body);
}

export default RightPanel;
