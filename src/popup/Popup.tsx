import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import type { RequestLog, Category } from "../types";
import { ext, sendMessage } from "../browserApi";
import { createPreviewLogs, isPreviewMode } from "./previewData";
import { explainRequestLocally } from "../utils/aiExplainer";
import type { ExplainResult } from "../utils/aiExplainer";
import { deriveMascotMood, useMascotSrc, RoamingMascot, Mascot } from "./Mascot";

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

// ─────────────────────────────────────────────
// ExplainButton — local on-device AI explainer
// ─────────────────────────────────────────────
function ExplainButton({
  url,
  method,
  payload,
  category,
}: {
  url: string;
  method: string;
  payload: string | null;
  category: string | null;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<ExplainResult | null>(null);

  const handleExplain = async () => {
    if (state === "loading") return;
    setState("loading");
    const r = await explainRequestLocally(url, method, payload, category);
    setResult(r);
    setState("done");
  };

  const badgeLabel =
    result?.source === "gemini-nano" ? "🤖 GEMINI NANO" : "🔍 HEURISTIC ANALYSIS";
  const badgeClass =
    result?.source === "gemini-nano" ? "explain-badge explain-badge--nano" : "explain-badge explain-badge--heuristic";

  return (
    <div className="explain-wrapper">
      {state === "idle" && (
        <button
          type="button"
          className="btn-explain"
          onClick={handleExplain}
          title="Analyse this request locally — no data leaves your device"
        >
          ✨ EXPLAIN
        </button>
      )}
      {state === "loading" && (
        <span className="explain-loading">Analyzing payload &amp; request semantics...</span>
      )}
      {state === "done" && result && (
        <div className="explain-card">
          <div className="explain-card__header">
            <span className={badgeClass}>{badgeLabel}</span>
            <button
              type="button"
              className="explain-dismiss"
              onClick={() => setState("idle")}
              aria-label="Dismiss explanation"
            >
              ✕
            </button>
          </div>
          <p className="explain-text">{result.text}</p>
        </div>
      )}
    </div>
  );
}

function DomainGroup({
  domain,
  logs,
  onBlock,
  onUnblock,
  onSpoof,
  onRequestOverride,
}: {
  domain: string;
  logs: RequestLog[];
  onBlock: (domain: string) => void;
  onUnblock: (domain: string) => void;
  onSpoof: (tabId: number) => void;
  onRequestOverride: (tabId: number, requestId: string, action: "allow" | "block") => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isAutoBlocked = logs.some((l) => l.isAutoBlocked);
  const isDomainBlocked = logs.some(
    (l) => l.isBlocked && (!l.overrideAction || logs.length === 1)
  );
  const hasRequestOverrideBlock = logs.some((l) => l.overrideAction === "block");
  const hasFlagged = logs.some((l) => l.severity === "flagged");
  const isSpoofable = logs.some((l) => l.spoofable);
  const isSpoofed = logs.some((l) => l.isSpoofed);
  const categories = Array.from(
    new Set(logs.map((l) => l.category).filter(Boolean))
  ) as Category[];

  return (
    <div
      className={`log-entry ${hasFlagged ? "flagged" : ""} ${isDomainBlocked || isAutoBlocked ? "blocked" : ""}`}
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
        {logs[0]?.partyContext === "1st-party" && (
          <span className="badge" style={{ borderColor: 'var(--terminal-green)', color: 'var(--terminal-green)' }}>1st Party</span>
        )}
        {logs[0]?.partyContext === "3rd-party" && (
          <span className="badge" style={{ borderColor: 'var(--terminal-warn)', color: 'var(--terminal-warn)' }}>3rd Party</span>
        )}
        {isAutoBlocked && <span className="badge blocked">Auto-block</span>}
        {isDomainBlocked && !isAutoBlocked && <span className="badge blocked">Blocked</span>}
        {hasRequestOverrideBlock && <span className="badge">Request Block</span>}
        {isSpoofed && <span className="badge spoofed">Spoofed</span>}
      </div>

      <div className="log-actions">
        {isAutoBlocked ? (
          <span className="auto-blocked">AUTO-BLOCKED TRACKER</span>
        ) : (
          <>
            {isDomainBlocked ? (
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
                {/* Visual Spoofing Breakdown */}
                {log.isSpoofed && (
                  <div
                    style={{
                      background: "rgba(45, 212, 191, 0.06)",
                      border: "1px solid rgba(45, 212, 191, 0.25)",
                      borderRadius: "4px",
                      padding: "8px 10px",
                      margin: "6px 0",
                      fontSize: "11px",
                      fontFamily: "var(--terminal-font)",
                    }}
                  >
                    <div style={{ color: "#2dd4bf", fontWeight: "bold", marginBottom: "4px", letterSpacing: "0.5px" }}>
                      🎭 ACTIVE DEFENSE: DATA SPOOFED
                    </div>
                    <div style={{ color: "#94a3b8", marginBottom: "2px" }}>
                      <span style={{ color: "#ff3e3e" }}>Actual: </span>
                      {log.category === "location"
                        ? "Real GPS Latitude & Longitude (Protected)"
                        : log.category === "fingerprinting"
                          ? "Real GPU, Screen & Canvas ID (Protected)"
                          : log.category === "pii"
                            ? "Personal Email, Phone & Name (Protected)"
                            : "Real User Data (Protected)"}
                    </div>
                    <div style={{ color: "#94a3b8" }}>
                      <span style={{ color: "#00ff41" }}>Sent:   </span>
                      {log.category === "location"
                        ? "Coords: (0.0000, 0.0000) [Null Island]"
                        : log.category === "fingerprinting"
                          ? "Intel Iris OpenGL Engine + Scrambled Pixel Noise"
                          : log.category === "pii"
                            ? "anonymous@privacy.local (Synthetic PII)"
                            : "Generic Synthetic Parameters"}
                    </div>
                  </div>
                )}
                {log.severity === "flagged" && (
                  <div className="log-alert">
                    {CATEGORY_LABELS[log.category!] || "SUSPICIOUS"}
                  </div>
                )}
                <p className="log-desc">{log.plainDescription}</p>
                <div className="log-url" title={log.url}>
                  {log.url}
                </div>
                <div className="log-actions" style={{ marginTop: "10px" }}>
                  <button
                    type="button"
                    className={log.overrideAction === "block" ? "btn-abort" : "btn-approve"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestOverride(log.tabId, log.id, log.overrideAction === "block" ? "allow" : "block");
                    }}
                  >
                    {log.overrideAction === "block" ? "ALLOW REQUEST" : "BLOCK REQUEST"}
                  </button>
                </div>
                <ExplainButton
                  url={log.url}
                  method={log.method}
                  payload={log.bodyPreview}
                  category={log.category}
                />
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
  const [filter, setFilter] = useState<FilterMode>("all"); //TODO maybe make it flagged
  const [hideFirstParty, setHideFirstParty] = useState(false);
  const [isMasterActive, setIsMasterActive] = useState(true);
  const [spoofEnabled, setSpoofEnabled] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | null>(preview ? 1 : null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (preview || !ext?.tabs?.query) return;

    const syncActiveTab = () => {
      ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) {
          setActiveTabId(tab.id);
          // Sync spoof toggle for this active tab
          ext.tabs.sendMessage(tab.id, { type: "GET_SPOOF_STATE" }, (res) => {
            if (!chrome.runtime.lastError && res) {
              setSpoofEnabled(res.enabled ?? false);
            }
          });
        }
      });
    };

    syncActiveTab();

    const onActivated = () => syncActiveTab();
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === "complete") {
        syncActiveTab();
      }
    };

    ext.tabs.onActivated?.addListener(onActivated);
    ext.tabs.onUpdated?.addListener(onUpdated);

    sendMessage({ type: "GET_MASTER_ACTIVE" }, (response) => {
      if (response && response.active !== undefined) {
        setIsMasterActive(response.active);
      }
    });

    return () => {
      ext.tabs.onActivated?.removeListener(onActivated);
      ext.tabs.onUpdated?.removeListener(onUpdated);
    };
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
      name: `spotlight-popup-${activeTabId}`,
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

  const handleRequestOverride = useCallback(
    (tabId: number, requestId: string, action: "allow" | "block") => {
      if (!preview) {
        sendMessage({ type: "SET_REQUEST_OVERRIDE", payload: { tabId, requestId, action } });
      }
      setRequestLogs((prev) =>
        prev.map((log) => {
          if (log.id !== requestId) return log;
          const nextIsBlocked = action === "block";

          const singleRequestForDomain =
            prev.filter((entry) => entry.domain === log.domain).length === 1;
          return {
            ...log,
            overrideAction: action,
          // do NOT toggle domain-wide isBlocked here
          // request override is independent from domain block state
          isBlocked: 
            action === "block" && (!log.isAutoBlocked || singleRequestForDomain),
          };
        })
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
  const openFlaggedCount = requestLogs.filter(
    (l) => l.severity === "flagged" && !l.isBlocked && !l.isAutoBlocked
  ).length;


  const filteredLogs = requestLogs.filter((log) => {
    if (hideFirstParty && log.partyContext === "1st-party") {
      return false;
    }
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
  const hasFlaggedGroups = groupedLogs.some(([, logs]) =>
    logs.some((log) => log.severity === "flagged" || log.isBlocked || log.isAutoBlocked)
  );

  const mascotMood = deriveMascotMood(
    isMasterActive,
    openFlaggedCount,
    groupedLogs.length
  );
  const mascotSrc = useMascotSrc(mascotMood);

  return (
    <div className="terminal-container" id="spotlight-root">
      <header className="terminal-header">
        <div className="window-controls" aria-hidden="true">
          <span className="control red" />
          <span className="control yellow" />
          <span className="control green" />
        </div>
        <img
          className="header-logo"
          src={ext?.runtime?.getURL?.("icons/icon128.png") ?? "/icons/icon128.png"}
          alt="SpotLight"
        />
        <h1 className="terminal-title">user@spotlight: ~</h1>
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
          <button
            type="button"
            className={`mode-btn ${hideFirstParty ? "mode-active" : ""}`}
            onClick={() => setHideFirstParty(!hideFirstParty)}
          >
            HIDE 1ST {hideFirstParty ? "ON" : "OFF"}
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

      <div className="console-shell" ref={shellRef}>
        <div className="console-output" ref={listRef} id="request-list">
          {!isMasterActive ? (
            <div className="log-entry system">
              <Mascot src={mascotSrc} size="hero" mood={mascotMood} />
              <div className="empty-cmd">
                <span className="log-method">$ guard --pause</span>
                <span className="cursor" />
              </div>
              <span className="empty-title">MONITORING PAUSED</span>
              <span className="empty-sub">
                Hit RUN or GUARD ON to watch what this page sends about you.
              </span>
            </div>
          ) : groupedLogs.length === 0 ? (
            <div className="log-entry system">
              <Mascot src={mascotSrc} size="hero" mood={mascotMood} />
              <div className="empty-cmd">
                <span className="log-method">$ tail -f requests</span>
                <span className="cursor" />
              </div>
              <span className="empty-title">
                {filter === "all" ? "WAITING FOR TRAFFIC" : `NO ${filter.toUpperCase()} REQUESTS`}
              </span>
              <span className="empty-sub">
                {filter === "all"
                  ? "If this tab was already open, reload it to inspect its traffic."
                  : "Try another tab, or keep browsing."}
              </span>
              {filter === "all" && activeTabId && (
                <button
                  className="btn-approve"
                  style={{ marginTop: "10px", padding: "5px 12px", width: "fit-content", fontSize: "11px" }}
                  onClick={() => {
                    ext.tabs?.reload?.(activeTabId);
                  }}
                >
                  [RELOAD TAB TO INSPECT]
                </button>
              )}
            </div>
          ) : (
            groupedLogs.map(([domain, logs], index) => {
              const isBadGroup =
                logs.some((log) => log.severity === "flagged" || log.isBlocked || log.isAutoBlocked);

              const showDivider =
                hasFlaggedGroups &&
                !isBadGroup &&
                groupedLogs
                  .slice(0, index)
                  .some(([, prevLogs]) =>
                    prevLogs.some(
                      (log) => log.severity === "flagged" || log.isBlocked || log.isAutoBlocked
                    )
                  );

              return (
                <Fragment key={domain}>
                  {showDivider && (
                    <div className="request-separator">
                      <span>neutral traffic</span>
                    </div>
                  )}

                  <DomainGroup
                    domain={domain}
                    logs={logs}
                    onBlock={handleBlock}
                    onUnblock={handleUnblock}
                    onSpoof={handleSpoof}
                    onRequestOverride={handleRequestOverride}
                  />
                </Fragment>
              );
            })
          )}
        </div>
        {isMasterActive && groupedLogs.length > 0 && (
          <RoamingMascot
            src={mascotSrc}
            mood={mascotMood}
            shellRef={shellRef}
            listRef={listRef}
          />
        )}
      </div>

      <footer className="terminal-footer">
        <span>
          {totalRequests} REQ · {flaggedCount} FLAG · {blockedCount} BLOCK
        </span>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span
            style={{ cursor: 'pointer', color: 'var(--terminal-blue)' }}
            onClick={() => {
              const data = JSON.stringify(requestLogs, null, 2);
              const blob = new Blob([data], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `spotlight-session-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            [EXPORT]
          </span>
          <span className={`footer-live ${isMasterActive ? "on" : ""}`}>
            {isMasterActive ? "LIVE" : "PAUSED"}
            {isMasterActive && <span className="cursor" />}
          </span>
        </div>
      </footer>
    </div>
  );
}

