import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { RequestLog, Category } from "../types";
import { ext, sendMessage } from "../browserApi";
import { createPreviewLogs, isPreviewMode } from "./previewData";

type FilterMode = "all" | "flagged" | "blocked" | "spoofed";

const CATEGORY_LABELS: Record<string, string> = {
  "known-tracker": "Tracker",
  fingerprinting: "Fingerprint",
  location: "Location",
  "extension-probe": "Ext. Probe",
  pii: "PII",
};

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function DomainGroup({
  domain,
  logs,
  onBlock,
  onUnblock,
  onSpoof,
}: {
  domain: string;
  logs: RequestLog[];
  onBlock: (domain: string) => void;
  onUnblock: (domain: string) => void;
  onSpoof: (tabId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isAutoBlocked = logs.some((l) => l.isAutoBlocked);
  const isBlocked = logs.some((l) => l.isBlocked);
  const hasFlagged = logs.some((l) => l.severity === "flagged");
  const isSpoofable = logs.some((l) => l.spoofable);
  const isSpoofed = logs.some((l) => l.isSpoofed);
  const categories = Array.from(
    new Set(logs.map((l) => l.category).filter(Boolean))
  ) as Category[];

  return (
    <div
      className={`log-entry ${hasFlagged ? "flagged" : ""} ${
        isBlocked || isAutoBlocked ? "blocked" : ""
      }`}
    >
      <div className="log-head" onClick={() => setExpanded(!expanded)}>
        {hasFlagged && <span className="log-flag">!</span>}
        <span className="log-domain">{domain}</span>
        <span className="log-count">[{logs.length}]</span>
        <span className="log-expand">{expanded ? "[-]" : "[+]"}</span>
      </div>

      <div className="log-badges">
        {categories.map((cat) => (
          <span key={cat} className={`badge ${cat}`}>
            {CATEGORY_LABELS[cat!] || cat}
          </span>
        ))}
        {isAutoBlocked && <span className="badge blocked">Auto-block</span>}
        {isBlocked && !isAutoBlocked && <span className="badge blocked">Blocked</span>}
        {isSpoofed && <span className="badge spoofed">Spoofed</span>}
      </div>

      <div className="log-actions">
        {isAutoBlocked ? (
          <span className="auto-blocked">AUTO-BLOCKED TRACKER</span>
        ) : (
          <>
            {isBlocked ? (
              <button
                className="btn-approve"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnblock(domain);
                }}
              >
                UNBLOCK
              </button>
            ) : (
              <button
                className="btn-abort"
                onClick={(e) => {
                  e.stopPropagation();
                  onBlock(domain);
                }}
              >
                BLOCK
              </button>
            )}
            {isSpoofable && !isSpoofed && (
              <button
                className="btn-approve"
                onClick={(e) => {
                  e.stopPropagation();
                  onSpoof(logs[0].tabId);
                }}
              >
                SPOOF
              </button>
            )}
          </>
        )}
      </div>

      {expanded && (
        <div className="log-details">
          {[...logs]
            .sort((a, b) => {
              if (a.severity === "flagged" && b.severity !== "flagged") return -1;
              if (a.severity !== "flagged" && b.severity === "flagged") return 1;
              return b.timestamp - a.timestamp;
            })
            .map((log) => (
              <div
                key={log.id}
                className={`log-line ${log.severity === "flagged" ? "flagged" : ""}`}
              >
                <div className="log-meta">
                  <span className="log-method">{log.method}</span>
                  <span className="log-time">{formatTime(log.timestamp)}</span>
                </div>
                {log.severity === "flagged" && (
                  <div className="log-alert">
                    {CATEGORY_LABELS[log.category!] || "SUSPICIOUS"}
                  </div>
                )}
                <p className="log-desc">{log.plainDescription}</p>
                <div className="log-url" title={log.url}>
                  {log.url}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function Popup() {
  const preview = isPreviewMode();
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>(() =>
    preview ? createPreviewLogs() : []
  );
  const [filter, setFilter] = useState<FilterMode>("all");
  const [isMasterActive, setIsMasterActive] = useState(true);
  const [spoofEnabled, setSpoofEnabled] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | null>(preview ? 1 : null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (preview) return;

    if (!ext?.tabs?.query) return;
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        setActiveTabId(tabs[0].id);
        return;
      }
      ext.tabs.query({ active: true, lastFocusedWindow: true }, (fallback) => {
        if (fallback[0]?.id) {
          setActiveTabId(fallback[0].id);
        }
      });
    });

    sendMessage({ type: "GET_MASTER_ACTIVE" }, (response) => {
      if (response && response.active !== undefined) {
        setIsMasterActive(response.active);
      }
    });
  }, [preview]);

  useEffect(() => {
    if (preview || activeTabId === null || !ext?.runtime?.connect) return;

    sendMessage(
      { type: "GET_TAB_LOG", payload: { tabId: activeTabId } },
      (response) => {
        if (response?.payload?.logs) {
          setRequestLogs(response.payload.logs);
        }
      }
    );

    const port = ext.runtime.connect({
      name: `beaconlight-popup-${activeTabId}`,
    });
    portRef.current = port;

    port.onMessage.addListener((message) => {
      if (message.type === "LIVE_UPDATE" && message.payload?.log) {
        setRequestLogs((prev) => {
          const updated = [...prev, message.payload.log];
          return updated.length > 500 ? updated.slice(-500) : updated;
        });
      } else if (message.type === "CLEAR_LOG") {
        if (message.payload?.tabId === activeTabId) {
          setRequestLogs([]);
        }
      }
    });

    return () => {
      port.disconnect();
      portRef.current = null;
    };
  }, [activeTabId, preview]);

  const handleMasterToggle = useCallback(() => {
    const newState = !isMasterActive;
    if (preview) {
      setIsMasterActive(newState);
      return;
    }
    sendMessage(
      { type: "SET_MASTER_ACTIVE", payload: { active: newState } },
      () => {
        setIsMasterActive(newState);
      }
    );
  }, [isMasterActive, preview]);

  const handleBlock = useCallback(
    (domain: string) => {
      if (!preview) {
        sendMessage({ type: "BLOCK_DOMAIN", payload: { domain } });
      }
      setRequestLogs((prev) =>
        prev.map((log) =>
          log.domain === domain ? { ...log, isBlocked: true } : log
        )
      );
    },
    [preview]
  );

  const handleUnblock = useCallback(
    (domain: string) => {
      if (!preview) {
        sendMessage({ type: "UNBLOCK_DOMAIN", payload: { domain } });
      }
      setRequestLogs((prev) =>
        prev.map((log) =>
          log.domain === domain ? { ...log, isBlocked: false } : log
        )
      );
    },
    [preview]
  );

  const handleSpoof = useCallback(
    (tabId: number) => {
      if (!preview) {
        sendMessage({ type: "ENABLE_SPOOF", payload: { tabId } });
      }
      setSpoofEnabled(true);
      setRequestLogs((prev) =>
        prev.map((log) => (log.spoofable ? { ...log, isSpoofed: true } : log))
      );
    },
    [preview]
  );

  const handleSpoofToggle = useCallback(() => {
    if (activeTabId === null) return;
    const next = !spoofEnabled;
    if (!preview) {
      sendMessage({
        type: next ? "ENABLE_SPOOF" : "DISABLE_SPOOF",
        payload: { tabId: activeTabId },
      });
    }
    setSpoofEnabled(next);
    setRequestLogs((prev) =>
      prev.map((log) => ({
        ...log,
        isSpoofed: next && log.spoofable,
      }))
    );
  }, [activeTabId, spoofEnabled, preview]);

  const totalRequests = requestLogs.length;
  const flaggedCount = requestLogs.filter((l) => l.severity === "flagged").length;
  const blockedCount = requestLogs.filter((l) => l.isBlocked || l.isAutoBlocked).length;

  const filteredLogs = requestLogs.filter((log) => {
    switch (filter) {
      case "flagged":
        return log.severity === "flagged";
      case "blocked":
        return log.isBlocked || log.isAutoBlocked;
      case "spoofed":
        return log.isSpoofed;
      default:
        return true;
    }
  });

  const groupedLogs = useMemo(() => {
    const groups: Record<string, RequestLog[]> = {};
    for (const log of filteredLogs) {
      if (!groups[log.domain]) {
        groups[log.domain] = [];
      }
      groups[log.domain].push(log);
    }
    return Object.entries(groups).sort(([, logsA], [, logsB]) => {
      const aFlagged = logsA.some((l) => l.severity === "flagged");
      const bFlagged = logsB.some((l) => l.severity === "flagged");
      if (aFlagged && !bFlagged) return -1;
      if (!aFlagged && bFlagged) return 1;
      return 0;
    });
  }, [filteredLogs]);

  return (
    <div className="terminal-container" id="beaconlight-root">
      <header className="terminal-header">
        <div className="window-controls" aria-hidden="true">
          <span className="control red" />
          <span className="control yellow" />
          <span className="control green" />
        </div>
        <h1 className="terminal-title">user@beaconlight: ~</h1>
        <span className={`token-counter ${flaggedCount > 0 ? "warning" : ""}`}>
          {flaggedCount} FLAG
        </span>
        <button
          type="button"
          className={`stop-button ${isMasterActive ? "" : "run"}`}
          onClick={handleMasterToggle}
        >
          {isMasterActive ? "PAUSE" : "RUN"}
        </button>
      </header>

      <div className="control-strip">
        <div className="mode-toggle">
          <button
            type="button"
            className={`mode-btn ${isMasterActive ? "mode-active" : ""}`}
            onClick={handleMasterToggle}
          >
            GUARD {isMasterActive ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            className={`mode-btn ${spoofEnabled ? "mode-active" : ""}`}
            onClick={handleSpoofToggle}
            disabled={!isMasterActive}
          >
            SPOOF {spoofEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-box stat-box--flag">
          <span className="stat-box__value">{flaggedCount}</span>
          <span className="stat-box__label">Flagged</span>
        </div>
        <div className="stat-box stat-box--block">
          <span className="stat-box__value">{blockedCount}</span>
          <span className="stat-box__label">Blocked</span>
        </div>
        <div className="stat-box">
          <span className="stat-box__value">{totalRequests}</span>
          <span className="stat-box__label">Total</span>
        </div>
      </div>

      <div className="tab-buttons" id="filter-bar">
        {(["all", "flagged", "blocked", "spoofed"] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`tab-btn ${filter === mode ? "active" : ""}`}
            onClick={() => setFilter(mode)}
            id={`filter-${mode}`}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="console-output" ref={listRef} id="request-list">
        {!isMasterActive ? (
          <div className="log-entry system">
            <span className="log-method">$ guard --pause</span>
            <span className="cursor" />
            <span className="empty-title">MONITORING PAUSED</span>
            <span className="empty-sub">
              Hit RUN or GUARD ON to watch what this page sends about you.
            </span>
          </div>
        ) : groupedLogs.length === 0 ? (
          <div className="log-entry system">
            <span className="log-method">$ tail -f requests</span>
            <span className="cursor" />
            <span className="empty-title">
              {filter === "all" ? "WAITING FOR TRAFFIC" : `NO ${filter.toUpperCase()} REQUESTS`}
            </span>
            <span className="empty-sub">
              {filter === "all"
                ? "Browse a site. Packets will print here as they leave the browser."
                : "Try another tab, or keep browsing."}
            </span>
          </div>
        ) : (
          groupedLogs.map(([domain, logs]) => (
            <DomainGroup
              key={domain}
              domain={domain}
              logs={logs}
              onBlock={handleBlock}
              onUnblock={handleUnblock}
              onSpoof={handleSpoof}
            />
          ))
        )}
      </div>

      <footer className="terminal-footer">
        <span>
          {totalRequests} REQ · {flaggedCount} FLAG · {blockedCount} BLOCK
        </span>
        <span className={`footer-live ${isMasterActive ? "on" : ""}`}>
          {isMasterActive ? "LIVE" : "PAUSED"}
          {isMasterActive && <span className="cursor" />}
        </span>
      </footer>
    </div>
  );
}
