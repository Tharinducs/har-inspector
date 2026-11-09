import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import SettingsIcon from "@material-ui/icons/Settings";
import CloseIcon from "@material-ui/icons/Close";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import CloudUploadIcon from "@material-ui/icons/CloudUpload";
import SearchIcon from "@material-ui/icons/Search";
import InsertDriveFileIcon from "@material-ui/icons/InsertDriveFile";
import VirtualList from "react-tiny-virtual-list";
import AutoSizer from "react-virtualized/dist/commonjs/AutoSizer";
import VirtualizedList from "react-virtualized/dist/commonjs/List";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Paper,
  Grid,
  Card,
  CardContent,
  Tabs,
  Tab,
  TextField,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  Chip,
  Divider,
  CircularProgress,
} from "@material-ui/core";
import "./styles.css";

const {
  RESOURCE_TYPES,
  statusGroup,
  isFailedRequest,
  parseHar,
  getEndpointKey,
  getCommonEndpointKeys,
  getComparisonStatus,
  getPairedEntries,
  getUrlHostnameCounts,
  getHarWarnings,
  getPerformanceSummary,
  getDuplicateEndpoints,
  redactSensitiveData,
} = require("./harUtils");
const {
  asText,
  formatPayload,
  isJsonPayload,
  getRequestBody,
  getLineDiff,
  getCharacterDiff,
  summarizeJsonDifferences,
} = require("./payloadUtils");
const { HISTORY_KEY, getSessionHistory, saveSessionHistory, clearSessionHistory } = require("./historyStorage");

const DEFAULTS = {
  show200: true,
  show30x: true,
  show40x: true,
  show50x: true,
  showResources: true,
  historyEnabled: true,
  searchTerms: "-ERR-",
};

const STATUS_GROUPS = ["200", "30x", "40x", "50x"];

const REQUEST_FILTERS_KEY = "harRequestFilters";
const DEFAULT_REQUEST_FILTERS = {
  tab: 0,
  filter: "all",
  query: "",
  resourceQuery: "",
  resourceTypeFilter: "all",
  statusFilter: "all",
};

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back when clipboard access is denied or unavailable.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  let copied = false;
  try {
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

const cleanExportEntry = (entry) => {
  const { _id, _status, _body, _requestBody, _requestType, _resource, _url, _method, _time, ...harEntry } = entry;
  return {
    ...harEntry,
    inspector: {
      status: entry._status,
      method: entry._method,
      url: entry._url,
      resourceType: entry._requestType,
      resource: entry._resource,
      time: entry._time,
    },
  };
};

  const normalizeJsonForDiff = (value, ignoreKeyOrder, ignoreArrayOrder) => {
    const raw = asText(value);
    try {
      const parsed = JSON.parse(raw.trim());
      const normalize = (item) => {
        if (Array.isArray(item)) {
          const normalized = item.map(normalize);
          return ignoreArrayOrder
            ? normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
            : normalized;
        }
        if (item && typeof item === "object") {
          const entries = Object.entries(item);
          if (ignoreKeyOrder) entries.sort(([left], [right]) => left.localeCompare(right));
          return Object.fromEntries(entries.map(([key, child]) => [key, normalize(child)]));
        }
        return item;
      };
      return JSON.stringify(normalize(parsed), null, 2);
    } catch {
      return raw;
    }
  };

  const buildCurl = (entry) => {
    const parts = [`curl '${String(entry.request?.url || entry._url || "").replace(/'/g, "'\\''")}'`];
    if (entry.request?.method) parts[0] += ` \\\n  -X ${entry.request.method}`;
    (entry.request?.headers || []).forEach((header) => {
      parts.push(`  -H '${String(header.name)}: ${String(header.value).replace(/'/g, "'\\''")}'`);
    });
    const body = getRequestBody(entry);
    if (body) parts.push(`  --data-raw '${String(body).replace(/'/g, "'\\''")}'`);
    return parts.join(" \\\n");
  };

  function RequestRow({ entry, selected, comparing, compareLimitReached, terms, maxVisibleTime, onSelect, onToggleCompare }) {
    const time = Number(entry._time || 0);
    const duration = `${time.toFixed(1)} ms`;
    const timingWidth = maxVisibleTime > 0
      ? Math.max(time > 0 ? 4 : 0, Math.min(100, (time / maxVisibleTime) * 100))
      : 0;
    const isSlow = time > 0 && time >= 500 && time >= maxVisibleTime * 0.75;
    return (
      <div className={`request-row-wrapper ${comparing ? "comparing" : ""}`}>
        <input
          type="checkbox"
          className="request-compare-checkbox"
          checked={comparing}
          disabled={!comparing && compareLimitReached}
          aria-label={`Select ${entry._method} ${entry._url} for comparison`}
          title={compareLimitReached && !comparing ? "Two requests are already selected" : "Select for comparison"}
          onChange={onToggleCompare}
        />
        <button
          data-request-id={entry._id}
          className={`request-row keyboard-row ${selected ? "selected" : ""}`}
          onClick={onSelect}
        >
          <div className="row-main">
            <span className={`method ${entry._method === "GET" ? "get" : "other-method"}`}>
              {entry._method}
            </span>
            <span className="url" title={entry._url}>{entry._url}</span>
            <span className={`status ${isFailedRequest(entry, terms) ? "failed-indicator" : entry._status >= 500 ? "s5" : entry._status >= 400 ? "s4" : entry._status >= 300 ? "s3" : entry._status >= 200 ? "s2" : "s0"}`}>
              {entry._status || "ERR"}
            </span>
          </div>
          <div className="row-meta">
            <span>{entry._resource !== "Other" ? entry._resource : "Request"}</span>
            <span className={`timing${isSlow ? " slow" : ""}`} title={isSlow ? "Slow request" : duration}>
              <span className="timing-duration">{duration}</span>
              <span className="timing-track" aria-hidden="true">
                <span style={{ width: `${timingWidth}%` }} />
              </span>
            </span>
            <span>
              {entry.response?.content?.size ?? entry.response?.bodySize ?? "—"} bytes
            </span>
          </div>
        </button>
      </div>
    );
  }

const downloadTextFile = (content, fileName, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const csvCell = (value) => {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const exportCsv = (entries) => {
  const columns = [
    ["method", (entry) => entry.request?.method || entry._method],
    ["url", (entry) => entry.request?.url || entry._url],
    ["status", (entry) => entry.response?.status ?? entry._status],
    ["statusText", (entry) => entry.response?.statusText || ""],
    ["resourceType", (entry) => entry._requestType],
    ["timeMs", (entry) => entry._time],
    ["requestBytes", (entry) => entry.request?.bodySize ?? ""],
    ["responseBytes", (entry) => entry.response?.bodySize ?? entry.response?.content?.size ?? ""],
    ["mimeType", (entry) => entry.response?.content?.mimeType || ""],
  ];
  const rows = entries.map((entry) => columns.map(([, getValue]) => csvCell(getValue(entry))).join(","));
  return `${columns.map(([name]) => csvCell(name)).join(",")}\r\n${rows.join("\r\n")}`;
};

const exportBaseName = (fileName) =>
  (fileName || "har-export")
    .replace(/\.har$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "har-export";

function App() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [entries, setEntries] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [view, setView] = useState("analysis");
  const [compareLeft, setCompareLeft] = useState([]);
  const [compareRight, setCompareRight] = useState([]);
  const [compareLeftName, setCompareLeftName] = useState("");
  const [compareRightName, setCompareRightName] = useState("");
  const [compareLeftId, setCompareLeftId] = useState(null);
  const [compareRightId, setCompareRightId] = useState(null);
  const [commonOnly, setCommonOnly] = useState(false);
  const [compareLeftQuery, setCompareLeftQuery] = useState("");
  const [compareRightQuery, setCompareRightQuery] = useState("");
  const [compareSharedQuery, setCompareSharedQuery] = useState("");
  const [separateComparisonSearch, setSeparateComparisonSearch] = useState(false);
  const [comparisonStatusFilter, setComparisonStatusFilter] = useState("all");
  const [comparisonIgnoreQuery, setComparisonIgnoreQuery] = useState(true);
  const [comparisonIgnoreIds, setComparisonIgnoreIds] = useState(true);
  const [comparisonMaskSensitive, setComparisonMaskSensitive] = useState(false);
  const [comparisonInsightsOpen, setComparisonInsightsOpen] = useState(false);

  const [tab, setTab] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [requestSort, setRequestSort] = useState("original");
  const [requestFiltersLoaded, setRequestFiltersLoaded] = useState(false);

  useEffect(() => {
    if (!entries.length) return undefined;
    try {
      const savedIds = JSON.parse(localStorage.getItem("harCompareIds") || "[]");
      const validIds = savedIds.filter((id) => entries.some((entry) => entry._id === id));
      if (validIds.length === 2 && compareIds.length === 0) setCompareIds(validIds);
    } catch {
      localStorage.removeItem("harCompareIds");
    }
  }, [entries]);

  useEffect(() => {
    if (compareIds.length === 2) {
      localStorage.setItem("harCompareIds", JSON.stringify(compareIds));
    } else if (compareIds.length === 0) {
      localStorage.removeItem("harCompareIds");
    }
  }, [compareIds]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletedHistoryEntry, setDeletedHistoryEntry] = useState(null);
  const undoTimeoutRef = useRef(null);
  const requestSearchRef = useRef(null);

  useEffect(() => () => window.clearTimeout(undoTimeoutRef.current), []);

  useEffect(() => {
    if (!globalThis.chrome?.storage?.local) {
      setRequestFiltersLoaded(true);
      setSettingsLoaded(true);
      return;
    }

    chrome.storage.local.get(["harSettings", REQUEST_FILTERS_KEY], (result) => {
      const storageError = globalThis.chrome?.runtime?.lastError;
      if (storageError) {
        setError(`Unable to load settings: ${storageError.message}`);
      } else {
        setSettings({ ...DEFAULTS, ...(result.harSettings || {}) });
        const savedFilters = result[REQUEST_FILTERS_KEY] || {};
        setTab(savedFilters.tab === 1 ? 1 : 0);
        setFilter(savedFilters.filter || "all");
        setQuery(savedFilters.query || "");
        setResourceQuery(savedFilters.resourceQuery || "");
        setResourceTypeFilter(savedFilters.resourceTypeFilter || "all");
        setStatusFilter(savedFilters.statusFilter || "all");
        setRequestSort(["original", "slowest", "fastest"].includes(savedFilters.requestSort)
          ? savedFilters.requestSort
          : "original");
        setComparisonIgnoreQuery(savedFilters.comparisonIgnoreQuery !== false);
        setComparisonIgnoreIds(savedFilters.comparisonIgnoreIds !== false);
      }
      setRequestFiltersLoaded(true);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!requestFiltersLoaded || !globalThis.chrome?.storage?.local) return undefined;
    const timeoutId = window.setTimeout(() => {
      chrome.storage.local.set({
        [REQUEST_FILTERS_KEY]: {
          tab,
          filter,
          query,
          resourceQuery,
          resourceTypeFilter,
          statusFilter,
          requestSort,
          comparisonIgnoreQuery,
          comparisonIgnoreIds,
        },
      });
    }, 150);
    return () => window.clearTimeout(timeoutId);
  }, [
    requestFiltersLoaded,
    tab,
    filter,
    query,
    resourceQuery,
    resourceTypeFilter,
    statusFilter,
    requestSort,
    comparisonIgnoreQuery,
    comparisonIgnoreIds,
  ]);

  useEffect(() => {
    if (!settingsLoaded) return undefined;

    let active = true;
    if (!settings.historyEnabled) setView("analysis");
    const loadHistory = settings.historyEnabled
      ? getSessionHistory()
      : clearSessionHistory().then(() => []);

    loadHistory
      .then((items) => {
        if (!active) return;
        setHistory(items);
        setHistoryLoaded(true);
        setHistoryError("");
      })
      .catch((storageError) => {
        if (active) {
          setHistoryLoaded(true);
          setHistoryError(
            `Unable to load upload history: ${storageError.message}`,
          );
        }
      });

    return () => {
      active = false;
    };
  }, [settings.historyEnabled, settingsLoaded]);

  const updateSetting = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaved(false);
  };

  const clearRequestFilters = () => {
    setTab(0);
    setFilter("all");
    setQuery("");
    setResourceQuery("");
    setResourceTypeFilter("all");
    setStatusFilter("all");
    setRequestSort("original");
  };

  const hasActiveRequestFilters =
    tab === 1 ||
    filter !== "all" ||
    !!query.trim() ||
    !!resourceQuery.trim() ||
    resourceTypeFilter !== "all" ||
    statusFilter !== "all" ||
    requestSort !== "original";

  const deleteHistoryItem = async (itemId) => {
    const deletedIndex = history.findIndex((item) => item.id === itemId);
    if (deletedIndex === -1) return;
    const deletedItem = history[deletedIndex];
    if (!window.confirm(`Delete ${deletedItem.fileName} from history?`)) return;

    try {
      const nextHistory = history.filter((item) => item.id !== itemId);
      await saveSessionHistory(nextHistory);
      setHistory(nextHistory);
      setHistoryError("");
      window.clearTimeout(undoTimeoutRef.current);
      setDeletedHistoryEntry({ item: deletedItem, index: deletedIndex });
      undoTimeoutRef.current = window.setTimeout(
        () => setDeletedHistoryEntry(null),
        8000,
      );
    } catch (storageError) {
      setHistoryError(
        `Unable to delete upload history item: ${storageError.message}`,
      );
    }
  };

  const undoDeleteHistoryItem = async () => {
    if (!deletedHistoryEntry) return;
    try {
      const { item, index } = deletedHistoryEntry;
      if (history.some((entry) => entry.id === item.id)) return;
      const nextHistory = [...history];
      nextHistory.splice(Math.min(index, nextHistory.length), 0, item);
      await saveSessionHistory(nextHistory);
      setHistory(nextHistory);
      window.clearTimeout(undoTimeoutRef.current);
      setDeletedHistoryEntry(null);
      setHistoryError("");
    } catch (storageError) {
      setHistoryError(
        `Unable to restore upload history item: ${storageError.message}`,
      );
    }
  };

  const saveSettings = async () => {
    try {
      if (globalThis.chrome?.storage?.local) {
        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ harSettings: settings }, () => {
            const storageError = globalThis.chrome?.runtime?.lastError;
            if (storageError) {
              reject(new Error(storageError.message));
              return;
            }
            resolve();
          });
        });
      }

      setError("");
      setSaved(true);
    } catch (storageError) {
      setSaved(false);
      setError(`Unable to save settings: ${storageError.message}`);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setLoading(true);
      setLoadingProgress(0);
      setLoadingMessage(file.size > 20 * 1024 * 1024 ? "Reading large HAR file..." : "Reading HAR file...");
      const content = await file.text();
      setLoadingMessage("Parsing requests...");
      const parsed = await parseHar(content, setLoadingProgress);
      const historyItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        content,
      };

      clearRequestFilters();
      localStorage.removeItem("harCompareIds");
      setCompareIds([]);
      setCompareOpen(false);
      setEntries(parsed);
      setFileName(file.name);
      setSelectedId(parsed[0]?._id ?? null);
      setView("analysis");

      if (settings.historyEnabled) {
        try {
          const existingHistory =
            historyLoaded && !historyError
              ? history
              : await getSessionHistory();
          const updatedHistory = [historyItem, ...existingHistory];
          await saveSessionHistory(updatedHistory);
          setHistory(updatedHistory);
          setHistoryLoaded(true);
          setHistoryError("");
        } catch (storageError) {
          setHistoryError(
            `Analysis loaded, but this HAR could not be saved to session history: ${storageError.message}`,
          );
        }
      }
    } catch (err) {
      setError(err.message || "Unable to parse this HAR file.");
      setEntries([]);
    } finally {
      setLoading(false);
      setLoadingProgress(0);
      setLoadingMessage("");
    }
    e.target.value = "";
  };

  const onCompareFile = async (e, side) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setLoading(true);
      setLoadingProgress(0);
      setLoadingMessage(`Reading ${side === "left" ? "first" : "second"} HAR file...`);
      const content = await file.text();
      setLoadingMessage("Parsing requests...");
      const parsed = await parseHar(content, setLoadingProgress);
      if (side === "left") {
        setCompareLeft(parsed);
        setCompareLeftName(file.name);
        setCompareLeftId(null);
      } else {
        setCompareRight(parsed);
        setCompareRightName(file.name);
        setCompareRightId(null);
      }
    } catch (compareError) {
      setError(compareError.message || "Unable to parse this HAR file.");
    } finally {
      setLoading(false);
      setLoadingProgress(0);
      setLoadingMessage("");
      e.target.value = "";
    }
  };

  const openHistoryItem = async (item) => {
    try {
      setLoading(true);
      setLoadingProgress(0);
      setLoadingMessage("Loading saved HAR...");
      const parsed = await parseHar(item.content, setLoadingProgress);
      clearRequestFilters();
      localStorage.removeItem("harCompareIds");
      setCompareIds([]);
      setCompareOpen(false);
      setEntries(parsed);
      setFileName(item.fileName);
      setSelectedId(parsed[0]?._id ?? null);
      setError("");
      setHistoryError("");
      setView("analysis");
    } catch (historyItemError) {
      setHistoryError(
        `Unable to open ${item.fileName}: ${historyItemError.message}`,
      );
    } finally {
      setLoading(false);
      setLoadingProgress(0);
      setLoadingMessage("");
    }
  };

  const terms = (settings.searchTerms || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const requestSummary = useMemo(() => {
    const counts = { "200": 0, "30x": 0, "40x": 0, "50x": 0, other: 0 };
    let resourceSuccess = 0;
    let resourceFailure = 0;
    let bodyMatches = 0;

    entries.forEach((entry) => {
      const group = statusGroup(entry._status);
      counts[group] = (counts[group] || 0) + 1;
      const failed = isFailedRequest(entry, terms);
      if (entry._resource !== "Other" && entry._status >= 200 && entry._status < 400 && !failed) resourceSuccess += 1;
      if (entry._resource !== "Other" && failed) resourceFailure += 1;
      if (terms.some((term) => String(entry._body || "").toLowerCase().includes(term.toLowerCase()))) bodyMatches += 1;
    });

    return { counts, resourceSuccess, resourceFailure, bodyMatches };
  }, [entries, settings.searchTerms]);

  const requestTypeCounts = useMemo(() => {
    const counts = Object.fromEntries(RESOURCE_TYPES.map((type) => [type, 0]));
    entries.forEach((entry) => {
      counts[entry._requestType] = (counts[entry._requestType] || 0) + 1;
    });
    return counts;
  }, [entries]);

  const visibleEntries = useMemo(() => {
    const filteredEntries = entries.filter((e) => {
        const group = statusGroup(e._status);
        if (group === "200" && !settings.show200) return false;
        if (group === "30x" && !settings.show30x) return false;
        if (group === "40x" && !settings.show40x) return false;
        if (group === "50x" && !settings.show50x) return false;
        if (
          tab === 0 &&
          statusFilter !== "all" &&
          statusGroup(e._status) !== statusFilter
        )
          return false;
        if (
          tab === 0 &&
          resourceTypeFilter !== "all" &&
          e._requestType !== resourceTypeFilter
        )
          return false;
        if (
          filter === "resource-success" &&
          !(
            settings.showResources &&
            e._resource !== "Other" &&
            e._status >= 200 &&
            e._status < 400 &&
            !isFailedRequest(e, terms)
          )
        )
          return false;
        if (
          filter === "resource-failure" &&
          !(
            settings.showResources &&
            e._resource !== "Other" &&
            isFailedRequest(e, terms)
          )
        )
          return false;
        if (
          filter === "search-match" &&
          !terms.some((t) =>
            (e._body || "").toLowerCase().includes(t.toLowerCase()),
          )
        )
          return false;
        if (
          query &&
          tab !== 0 &&
          !`${e._url} ${e._method} ${e._status} ${e._resource}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
          return false;
        if (
          tab === 0 &&
          resourceQuery &&
          !`${e._url} ${e._method} ${e._status} ${e._resource} ${e._requestType}`
            .toLowerCase()
            .includes(resourceQuery.toLowerCase())
        )
          return false;
        return true;
      });
    if (requestSort === "slowest") {
      return [...filteredEntries].sort((left, right) => right._time - left._time);
    }
    if (requestSort === "fastest") {
      return [...filteredEntries].sort((left, right) => left._time - right._time);
    }
    return filteredEntries;
  },
    [entries, settings, filter, query, resourceQuery, tab, resourceTypeFilter, statusFilter, requestSort],
  );

  const maxVisibleTime = visibleEntries.reduce(
    (maximum, entry) => Math.max(maximum, Number(entry._time || 0)),
    0,
  );
  const selectRequest = (id) => {
    setSelectedId(id);
    setCompareOpen(false);
  };

  const selected = entries.find((e) => e._id === selectedId);
  const compareEntries = compareIds.map((id) => entries.find((e) => e._id === id)).filter(Boolean);
  const requestBodiesMatch = compareEntries.length === 2 &&
    getRequestBody(compareEntries[0]) === getRequestBody(compareEntries[1]);
  const responseBodiesMatch = compareEntries.length === 2 &&
    (compareEntries[0].response?.content?.text ?? "") ===
      (compareEntries[1].response?.content?.text ?? "");

  const exportRequests = (format) => {
    const baseName = exportBaseName(fileName);
    if (format === "csv") {
      downloadTextFile(exportCsv(visibleEntries), `${baseName}-filtered.csv`, "text/csv;charset=utf-8");
    } else {
      downloadTextFile(
        JSON.stringify(visibleEntries.map(cleanExportEntry), null, 2),
        `${baseName}-filtered.json`,
        "application/json;charset=utf-8",
      );
    }
  };

  const exportSelected = () => {
    const baseName = exportBaseName(fileName);
    downloadTextFile(
      JSON.stringify(compareEntries.map(cleanExportEntry), null, 2),
      `${baseName}-selected.json`,
      "application/json;charset=utf-8",
    );
  };
  const exportComparisonReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      files: { left: compareLeftName, right: compareRightName },
      summary: { left: comparisonSummaryLeft, right: comparisonSummaryRight },
      warnings: comparisonWarnings,
      domains: comparisonDomains.map(([hostname, count]) => ({ hostname, requests: count })),
      pairedRequests: pairedEntries.map(([left, right]) => ({
        left: comparisonMaskSensitive ? redactSensitiveData(left._url) : left._url,
        right: comparisonMaskSensitive ? redactSensitiveData(right._url) : right._url,
        status: getComparisonStatus(left, compareLeft, "left", compareRight, comparisonEndpointOptions),
      })),
    };
    downloadTextFile(
      JSON.stringify(report, null, 2),
      "har-comparison-report.json",
      "application/json;charset=utf-8",
    );
  };
  const count = (group) => requestSummary.counts[group] || 0;
  const resourceSuccess = requestSummary.resourceSuccess;
  const resourceFailure = requestSummary.resourceFailure;
  const matches = { length: requestSummary.bodyMatches };

  const comparisonEndpointOptions = {
    ignoreQueryValues: comparisonIgnoreQuery,
    ignoreIds: comparisonIgnoreIds,
  };
  const commonEndpointKeys = useMemo(
    () => getCommonEndpointKeys(compareLeft, compareRight, comparisonEndpointOptions),
    [compareLeft, compareRight, comparisonIgnoreQuery, comparisonIgnoreIds],
  );
  const filterCompareEntries = (entriesForSide, query, commonKeys) =>
    entriesForSide.filter((entry) => {
      if (commonOnly && !commonKeys.has(getEndpointKey(entry, comparisonEndpointOptions))) return false;
      if (!query.trim()) return true;
      const searchable = `${entry._method} ${entry._url} ${entry._status} ${entry._resource} ${entry._requestType}`;
      return searchable.toLowerCase().includes(query.trim().toLowerCase());
    });
  const leftComparisonQuery = separateComparisonSearch ? compareLeftQuery : compareSharedQuery;
  const rightComparisonQuery = separateComparisonSearch ? compareRightQuery : compareSharedQuery;
  const visibleCompareLeft = filterCompareEntries(compareLeft, leftComparisonQuery, commonEndpointKeys);
  const visibleCompareRight = filterCompareEntries(compareRight, rightComparisonQuery, commonEndpointKeys);
  const filteredCompareLeft = comparisonStatusFilter === "all"
    ? visibleCompareLeft
    : visibleCompareLeft.filter((entry) =>
      getComparisonStatus(entry, compareLeft, "left", compareRight, comparisonEndpointOptions) === comparisonStatusFilter,
    );
  const filteredCompareRight = comparisonStatusFilter === "all"
    ? visibleCompareRight
    : visibleCompareRight.filter((entry) =>
      getComparisonStatus(entry, compareRight, "right", compareLeft, comparisonEndpointOptions) === comparisonStatusFilter,
    );
  const pairedEntries = getPairedEntries(compareLeft, compareRight, comparisonEndpointOptions);
  const findPairedEntry = (entry, side) => {
    const pair = pairedEntries.find(([left, right]) =>
      side === "left" ? left === entry : right === entry,
    );
    return pair ? (side === "left" ? pair[1] : pair[0]) : null;
  };
  const compareLeftEntry = compareLeft.find((entry) => entry._id === compareLeftId);
  const compareRightEntry = compareRight.find((entry) => entry._id === compareRightId);
  const crossRequestBodiesMatch = Boolean(compareLeftEntry && compareRightEntry) &&
    getRequestBody(compareLeftEntry) === getRequestBody(compareRightEntry);
  const crossResponseBodiesMatch = Boolean(compareLeftEntry && compareRightEntry) &&
    (compareLeftEntry.response?.content?.text ?? "") ===
      (compareRightEntry.response?.content?.text ?? "");
  const crossJsonChanges = compareLeftEntry && compareRightEntry
    ? summarizeJsonDifferences(
      compareLeftEntry.response?.content?.text ?? "",
      compareRightEntry.response?.content?.text ?? "",
    )
    : [];
  const comparisonSummaryLeft = getPerformanceSummary(compareLeft);
  const comparisonSummaryRight = getPerformanceSummary(compareRight);
  const comparisonWarnings = getHarWarnings([...compareLeft, ...compareRight]);
  const comparisonDomains = getUrlHostnameCounts([...compareLeft, ...compareRight]);
  const comparisonDuplicates = getDuplicateEndpoints([...compareLeft, ...compareRight], comparisonEndpointOptions);

  useEffect(() => {
    const handleKeyboardNavigation = (event) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);

      if (event.key === "/" && !isEditing) {
        event.preventDefault();
        requestSearchRef.current?.focus();
        requestSearchRef.current?.select();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (compareIds.length === 2) setCompareOpen(true);
        return;
      }

      if (event.key === "Escape") {
        if (isEditing) {
          if (tab === 0 && resourceQuery) setResourceQuery("");
          else if (tab === 1 && query) setQuery("");
          else target.blur();
        } else if (compareOpen) {
          setCompareOpen(false);
        } else if (selectedId !== null) {
          setSelectedId(null);
        }
        return;
      }

      if (isEditing || !visibleEntries.length) return;

      if (event.key === "Enter" && selectedId !== null) {
        event.preventDefault();
        window.requestAnimationFrame(() => {
          document.querySelector(".detail")?.scrollIntoView({ block: "start" });
        });
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = visibleEntries.findIndex((entry) => entry._id === selectedId);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = currentIndex === -1
          ? (direction === 1 ? 0 : visibleEntries.length - 1)
          : Math.max(0, Math.min(visibleEntries.length - 1, currentIndex + direction));
        const nextEntry = visibleEntries[nextIndex];
        setSelectedId(nextEntry._id);
        setCompareOpen(false);
        window.requestAnimationFrame(() => {
          document.querySelector(`[data-request-id="${nextEntry._id}"]`)?.scrollIntoView({
            block: "nearest",
          });
        });
      }
    };

    window.addEventListener("keydown", handleKeyboardNavigation);
    return () => window.removeEventListener("keydown", handleKeyboardNavigation);
  }, [compareIds, compareOpen, query, resourceQuery, selectedId, tab, visibleEntries]);

  const fmt = (n) => `${Number(n || 0).toFixed(1)} ms`;

  return (
    <div className="app">
      <AppBar position="static" className="topbar">
        <Toolbar>
          <div className="brand-mark">
            <InsertDriveFileIcon className="brand-file-icon" />
            <SearchIcon className="brand-search-icon" />
            <span className="brand-spark">✓</span>
          </div>
          <div className="brand">
            <Typography variant="h6">HAR Inspector</Typography>
            <Typography variant="caption">
              Network insights, made simple
            </Typography>
          </div>
          <div className="grow" />
          <Button
            className="settings-toggle"
            onClick={() => {
              setView(view === "compare" ? "analysis" : "compare");
              setSettingsOpen(false);
            }}
          >
            {view === "compare" ? "Back to analysis" : "Compare HARs"}
          </Button>
          {settings.historyEnabled && (
            <Button
              className="settings-toggle"
              onClick={() => {
                setView(view === "history" ? "analysis" : "history");
                setSettingsOpen(false);
              }}
            >
              {view === "history" ? "Back to analysis" : "History"}
            </Button>
          )}
          {view !== "history" && (
            <Button
              className={`settings-toggle ${settingsOpen ? "settings-toggle-open" : ""}`}
              startIcon={settingsOpen ? <CloseIcon /> : <SettingsIcon />}
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              {settingsOpen ? "Close settings" : "Settings"}
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <main className={`main ${view === "history" ? "history-mode" : ""} ${view === "compare" ? "compare-mode" : ""}`}>
        {loading && (
          <div className="loading-banner" role="status" aria-live="polite">
            <div className="loading-banner-head">
              <strong>{loadingMessage}</strong>
              <span>{loadingProgress}%</span>
            </div>
            <div className="loading-progress" aria-label={`${loadingProgress}% loaded`}>
              <span style={{ width: `${loadingProgress}%` }} />
            </div>
          </div>
        )}
        {view === "history" && (
          <section className="history-section">
            <Typography variant="h4">Upload history</Typography>
            {historyError && (
              <Paper className="error-box" role="alert">
                {historyError}
              </Paper>
            )}
            {!historyLoaded ? (
              <Paper className="panel">
                <Typography color="textSecondary">
                  Loading session history...
                </Typography>
              </Paper>
            ) : history.length ? (
              <Paper className="history-list panel">
                {history.map((item) => (
                  <div key={item.id} className="history-item">
                    <button
                      className="history-open-item"
                      onClick={() => openHistoryItem(item)}
                    >
                      <span className="history-file-name">{item.fileName}</span>
                      <time dateTime={item.uploadedAt}>
                        {new Date(item.uploadedAt).toLocaleString()}
                      </time>
                    </button>
                    <Button
                      className="history-delete-button"
                      size="small"
                      aria-label={`Delete ${item.fileName} from history`}
                      title="Delete from history"
                      startIcon={<DeleteOutlineIcon />}
                      onClick={() => deleteHistoryItem(item.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </Paper>
            ) : (
              <Paper className="empty panel">
                <Typography variant="h5">No upload history yet</Typography>
                <Typography color="textSecondary">
                  HAR files you upload during this browser session will appear
                  here.
                </Typography>
              </Paper>
            )}
          </section>
        )}
        {deletedHistoryEntry && (
          <div className="history-delete-toast" role="status">
            <span>{deletedHistoryEntry.item.fileName} deleted</span>
            <Button size="small" onClick={undoDeleteHistoryItem}>Undo</Button>
          </div>
        )}
        {view === "compare" && (
          <section className="compare-section">
            <div className="compare-heading">
              <div>
                <Typography variant="h4">Compare two HAR files</Typography>
                <Typography color="textSecondary">
                  Load both captures, filter shared APIs, and compare selected requests.
                </Typography>
              </div>
              {compareLeft.length > 0 && compareRight.length > 0 && (
                <Chip
                  className={commonOnly ? "common-filter-active" : ""}
                  label={`Common APIs (${commonEndpointKeys.size})`}
                  clickable
                  color={commonOnly ? "primary" : "default"}
                  onClick={() => setCommonOnly(!commonOnly)}
                />
              )}
            </div>
            {(compareLeft.length > 0 || compareRight.length > 0) && (
              <div className="comparison-search-controls">
                <FormControlLabel
                  control={
                    <Switch
                      color="primary"
                      checked={separateComparisonSearch}
                      onChange={(event) => setSeparateComparisonSearch(event.target.checked)}
                    />
                  }
                  label="Separate searches"
                />
                <FormControlLabel
                  control={<Switch color="primary" checked={comparisonIgnoreQuery} onChange={(event) => setComparisonIgnoreQuery(event.target.checked)} />}
                  label="Ignore query values"
                />
                <FormControlLabel
                  control={<Switch color="primary" checked={comparisonIgnoreIds} onChange={(event) => setComparisonIgnoreIds(event.target.checked)} />}
                  label="Ignore dynamic IDs"
                />
                <FormControlLabel
                  control={<Switch color="primary" checked={comparisonMaskSensitive} onChange={(event) => setComparisonMaskSensitive(event.target.checked)} />}
                  label="Mask sensitive data"
                />
              </div>
            )}
            {!separateComparisonSearch && (compareLeft.length > 0 || compareRight.length > 0) && (
              <Paper className="compare-shared-search">
                <TextField
                  fullWidth
                  size="small"
                  variant="outlined"
                  value={compareSharedQuery}
                  onChange={(event) => setCompareSharedQuery(event.target.value)}
                  placeholder="Search both HAR request lists..."
                  inputProps={{ "aria-label": "Search both HAR request lists" }}
                />
                {compareSharedQuery && (
                  <Button size="small" onClick={() => setCompareSharedQuery("")}>Clear</Button>
                )}
              </Paper>
            )}
            {(compareLeft.length > 0 || compareRight.length > 0) && (
              <div className="comparison-status-pills" role="group" aria-label="Filter comparison status">
                {[
                  ["all", "All", Math.max(compareLeft.length, compareRight.length)],
                  ["changed", "Changed", compareLeft.filter((entry) => getComparisonStatus(entry, compareLeft, "left", compareRight, comparisonEndpointOptions) === "changed").length],
                  ["unchanged", "Unchanged", compareLeft.filter((entry) => getComparisonStatus(entry, compareLeft, "left", compareRight, comparisonEndpointOptions) === "unchanged").length],
                  ["added", "Added", compareRight.filter((entry) => getComparisonStatus(entry, compareRight, "right", compareLeft, comparisonEndpointOptions) === "added").length],
                  ["removed", "Removed", compareLeft.filter((entry) => getComparisonStatus(entry, compareLeft, "left", compareRight, comparisonEndpointOptions) === "removed").length],
                ].map(([value, label, count]) => (
                  <button
                    type="button"
                    key={value}
                    className={comparisonStatusFilter === value ? `active comparison-${value}` : `comparison-${value}`}
                    aria-pressed={comparisonStatusFilter === value}
                    onClick={() => setComparisonStatusFilter(value)}
                  >
                    {label} <span>{count}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="compare-upload-grid">
              {[
                ["left", compareLeft, compareLeftName],
                ["right", compareRight, compareRightName],
              ].map(([side, entriesForSide, name]) => (
                <Paper className="panel compare-upload" key={side}>
                  <div
                    className={`compare-upload-dropzone ${entriesForSide.length ? "has-file" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.currentTarget.classList.add("dragging");
                    }}
                    onDragLeave={(event) => event.currentTarget.classList.remove("dragging")}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.currentTarget.classList.remove("dragging");
                      const file = event.dataTransfer.files?.[0];
                      if (!file) return;
                      const input = document.getElementById(`compare-har-${side}`);
                      if (!input) return;
                      const dataTransfer = new DataTransfer();
                      dataTransfer.items.add(file);
                      input.files = dataTransfer.files;
                      input.dispatchEvent(new Event("change", { bubbles: true }));
                    }}
                  >
                  <div className="compare-upload-head">
                    <div>
                      <Typography variant="h6">{side === "left" ? "HAR 1" : "HAR 2"}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        {name || (side === "left" ? "First capture" : "Second capture")}
                      </Typography>
                    </div>
                    {entriesForSide.length > 0 && (
                      <Chip size="small" label={`${entriesForSide.length} requests`} />
                    )}
                  </div>
                  <input
                    id={`compare-har-${side}`}
                    type="file"
                    accept=".har,application/json,application/har+json"
                    onChange={(event) => onCompareFile(event, side)}
                    hidden
                  />
                  <label htmlFor={`compare-har-${side}`}>
                    <Button variant="outlined" color="primary" component="span">
                      {entriesForSide.length ? "Replace file" : "Choose HAR file"}
                    </Button>
                  </label>
                  </div>
                </Paper>
              ))}
            </div>

            {(compareLeft.length > 0 || compareRight.length > 0) && (
              (!compareLeftEntry || !compareRightEntry) && (
                <div className="comparison-selection-hint" role="status">
                  <strong>
                    {Number(Boolean(compareLeftEntry)) + Number(Boolean(compareRightEntry))}/2 selected
                  </strong>
                  <span>Select one request from each HAR file to compare them side by side.</span>
                </div>
              )
            )}
            {(compareLeft.length > 0 || compareRight.length > 0) && (
              <div className={`comparison-insights-panel ${comparisonInsightsOpen ? "open" : "closed"}`}>
                <button
                  type="button"
                  className="comparison-insights-toggle"
                  aria-expanded={comparisonInsightsOpen}
                  onClick={() => setComparisonInsightsOpen(!comparisonInsightsOpen)}
                >
                  <span>
                    <Typography variant="subtitle1">Comparison insights</Typography>
                    <Typography variant="caption" color="textSecondary">
                      Performance, domains, duplicates, and HAR warnings
                    </Typography>
                  </span>
                  <span>{comparisonInsightsOpen ? "Collapse" : "Expand"}</span>
                </button>
                {comparisonInsightsOpen && <div className="comparison-insights">
                <Paper className="panel comparison-performance">
                  <Typography variant="subtitle1">Performance summary</Typography>
                  <div className="performance-columns">
                    {[["HAR 1", comparisonSummaryLeft], ["HAR 2", comparisonSummaryRight]].map(([name, summary]) => (
                      <div key={name}>
                        <strong>{name}</strong>
                        <span>{summary.totalDuration.toFixed(1)} ms total</span>
                        <span>{summary.totalSize.toLocaleString()} bytes</span>
                        <small>{summary.slowest.length ? `${summary.slowest[0].url} · ${summary.slowest[0].time.toFixed(1)} ms` : ""}</small>
                      </div>
                    ))}
                  </div>
                </Paper>
                <Paper className="panel comparison-domains">
                  <Typography variant="subtitle1">Domains</Typography>
                  {comparisonDomains.slice(0, 6).map(([hostname, count]) => (
                    <div key={hostname}><span>{hostname}</span><b>{count}</b></div>
                  ))}
                </Paper>
                <Paper className="panel comparison-warnings">
                  <Typography variant="subtitle1">HAR warnings ({comparisonWarnings.length})</Typography>
                  {comparisonWarnings.slice(0, 4).map((warning, index) => (
                    <div key={`${warning.type}-${warning.index}-${index}`}>
                      <span>{warning.type}</span>{warning.message}
                    </div>
                  ))}
                  {!comparisonWarnings.length && <small>No validation issues detected.</small>}
                </Paper>
                <Paper className="panel comparison-duplicates">
                  <Typography variant="subtitle1">Duplicates ({comparisonDuplicates.length})</Typography>
                  {comparisonDuplicates.slice(0, 5).map(([key, entriesForKey]) => (
                    <div key={key}>
                      <span title={key}>{key}</span><b>{entriesForKey.length}</b>
                    </div>
                  ))}
                  {!comparisonDuplicates.length && <small>No duplicate endpoints detected.</small>}
                </Paper>
                <Button className="comparison-export-button" variant="outlined" size="small" onClick={exportComparisonReport}>
                  Export comparison JSON
                </Button>
                </div>}
              </div>
            )}

            {(compareLeft.length > 0 || compareRight.length > 0) && (
              <div className="compare-request-grid">
                {[
                  ["left", filteredCompareLeft, compareLeftId, setCompareLeftId, compareLeftName],
                  ["right", filteredCompareRight, compareRightId, setCompareRightId, compareRightName],
                ].map(([side, entriesForSide, selectedIdForSide, setSelectedIdForSide, name]) => (
                  <Paper className="panel compare-request-panel" key={side}>
                    <div className="compare-list-head">
                      <Typography variant="subtitle1">{name || `HAR ${side === "left" ? 1 : 2}`}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        {entriesForSide.length.toLocaleString()} shown
                      </Typography>
                    </div>
                    {separateComparisonSearch && <div className="compare-list-search">
                      <TextField
                        fullWidth
                        size="small"
                        variant="outlined"
                        value={side === "left" ? compareLeftQuery : compareRightQuery}
                        onChange={(event) => {
                          if (side === "left") setCompareLeftQuery(event.target.value);
                          else setCompareRightQuery(event.target.value);
                        }}
                        placeholder="Search method, URL, status..."
                        inputProps={{ "aria-label": `Search requests in ${name || `HAR ${side === "left" ? 1 : 2}`}` }}
                      />
                      {(side === "left" ? compareLeftQuery : compareRightQuery) && (
                        <Button
                          size="small"
                          onClick={() => {
                            if (side === "left") setCompareLeftQuery("");
                            else setCompareRightQuery("");
                          }}
                        >
                          Clear
                        </Button>
                      )}
                    </div>}
                    <div className="compare-request-list">
                      {entriesForSide.map((entry) => (
                        <button
                          type="button"
                          key={entry._id}
                          className={`compare-request-row ${selectedIdForSide === entry._id ? "selected" : ""}`}
                          onClick={() => {
                            setSelectedIdForSide(entry._id);
                            const counterpart = findPairedEntry(entry, side);
                            if (counterpart) {
                              if (side === "left") setCompareRightId(counterpart._id);
                              else setCompareLeftId(counterpart._id);
                            }
                          }}
                        >
                          <span className={`method ${entry._method === "GET" ? "get" : "other-method"}`}>
                            {entry._method}
                          </span>
                          <span className="compare-request-url" title={entry._url}>{entry._url}</span>
                          <span className={`status s${entry._status >= 500 ? 5 : entry._status >= 400 ? 4 : entry._status >= 300 ? 3 : entry._status >= 200 ? 2 : 0}`}>
                            {entry._status || "ERR"}
                          </span>
                          <span className={`comparison-status comparison-status-${getComparisonStatus(entry, side === "left" ? compareLeft : compareRight, side, side === "left" ? compareRight : compareLeft, comparisonEndpointOptions)}`}>
                            {getComparisonStatus(entry, side === "left" ? compareLeft : compareRight, side, side === "left" ? compareRight : compareLeft, comparisonEndpointOptions)}
                          </span>
                        </button>
                      ))}
                      {!entriesForSide.length && (
                        <div className="no-results">
                          {commonOnly && compareLeft.length && compareRight.length
                            ? "No shared APIs match this filter."
                            : "Upload a HAR file to see requests."}
                        </div>
                      )}
                    </div>
                  </Paper>
                ))}
              </div>
            )}

            {compareLeftEntry && compareRightEntry && (
              <Paper className="panel comparison-panel cross-har-comparison">
                <div className="detail-heading">
                  <div>
                    <Typography variant="h6">Selected request comparison</Typography>
                    <Typography variant="caption" color="textSecondary">
                      One request selected from each HAR file
                    </Typography>
                  </div>
                  <div>
                    {pairedEntries.length > 1 && (
                      <>
                        <Button size="small" onClick={() => {
                          const index = pairedEntries.findIndex(([left, right]) => left === compareLeftEntry || right === compareRightEntry);
                          const [left, right] = pairedEntries[Math.max(0, index - 1)];
                          setCompareLeftId(left._id);
                          setCompareRightId(right._id);
                        }}>Previous pair</Button>
                        <Button size="small" onClick={() => {
                          const index = pairedEntries.findIndex(([left, right]) => left === compareLeftEntry || right === compareRightEntry);
                          const [left, right] = pairedEntries[Math.min(pairedEntries.length - 1, index + 1)];
                          setCompareLeftId(left._id);
                          setCompareRightId(right._id);
                        }}>Next pair</Button>
                      </>
                    )}
                  <Button size="small" onClick={() => {
                    setCompareLeftId(null);
                    setCompareRightId(null);
                  }}>Clear selection</Button>
                  </div>
                </div>
                <div className="cross-request-summary">
                  {[compareLeftEntry, compareRightEntry].map((entry, index) => (
                    <div key={index}>
                      <strong>{index === 0 ? compareLeftName : compareRightName}</strong>
                      <span>Status {entry._status || "ERR"}</span>
                      <span>{Number(entry._time || 0).toFixed(1)} ms</span>
                      <span>{Number(entry.response?.content?.size || entry.response?.bodySize || 0).toLocaleString()} bytes</span>
                    </div>
                  ))}
                </div>
                <div className={`comparison-body-status ${crossRequestBodiesMatch ? "same" : "different"}`}>
                  Request bodies are <strong>{crossRequestBodiesMatch ? "identical" : "different"}</strong>
                </div>
                <div className={`comparison-body-status ${crossResponseBodiesMatch ? "same" : "different"}`}>
                  Response bodies are <strong>{crossResponseBodiesMatch ? "identical" : "different"}</strong>
                </div>
                {crossJsonChanges.length > 0 && (
                  <div className="json-change-summary">
                    <Typography variant="subtitle2">JSON field changes ({crossJsonChanges.length})</Typography>
                    {crossJsonChanges.map((change) => (
                      <div key={`${change.type}-${change.path}`} className={`json-change json-change-${change.type}`}>
                        <strong>{change.type}</strong>
                        <code>{change.path}</code>
                      </div>
                    ))}
                  </div>
                )}
                <div className="comparison-grid">
                  {[compareLeftEntry, compareRightEntry].map((entry, entryIndex) => (
                    <div className="comparison-column" key={entryIndex}>
                      <div className="comparison-summary">
                        <span className={`method ${entry._method === "GET" ? "get" : "other-method"}`}>{entry._method}</span>
                        <span className={`status s${entry._status >= 500 ? 5 : entry._status >= 400 ? 4 : entry._status >= 300 ? 3 : entry._status >= 200 ? 2 : 0}`}>
                          {entry._status || "ERR"}
                        </span>
                        <strong>{entry._url}</strong>
                        <Typography variant="caption" color="textSecondary">
                          {fmt(entry._time)} · {entry._resource}
                        </Typography>
                      </div>
                      <div className="comparison-request-body">
                        <DiffPayload
                          title={`Request body${crossRequestBodiesMatch ? " · Same" : " · Different"}`}
                          value={comparisonMaskSensitive ? redactSensitiveData(getRequestBody(entry)) : getRequestBody(entry) || "(No request body recorded)"}
                          otherValue={comparisonMaskSensitive ? redactSensitiveData(getRequestBody(entryIndex === 0 ? compareRightEntry : compareLeftEntry)) : getRequestBody(entryIndex === 0 ? compareRightEntry : compareLeftEntry) || "(No request body recorded)"}
                          side={entryIndex === 0 ? "left" : "right"}
                          syncGroup="cross-request-body"
                        />
                      </div>
                      <Payload title="Request headers" value={entry.request?.headers?.map((header) => ({
                        [header.name]: comparisonMaskSensitive ? redactSensitiveData(header.value) : header.value,
                      }))} />
                      <Payload title="Response headers" value={entry.response?.headers?.map((header) => ({
                        [header.name]: comparisonMaskSensitive ? redactSensitiveData(header.value) : header.value,
                      }))} />
                      <DiffPayload
                        title={`Response body${crossResponseBodiesMatch ? " · Same" : " · Different"}`}
                        value={comparisonMaskSensitive ? redactSensitiveData(entry.response?.content?.text ?? "") : entry.response?.content?.text ?? ""}
                        otherValue={comparisonMaskSensitive ? redactSensitiveData((entryIndex === 0 ? compareRightEntry : compareLeftEntry).response?.content?.text ?? "") : (entryIndex === 0 ? compareRightEntry : compareLeftEntry).response?.content?.text ?? ""}
                        side={entryIndex === 0 ? "left" : "right"}
                        syncGroup="cross-response-body"
                      />
                    </div>
                  ))}
                </div>
              </Paper>
            )}
          </section>
        )}
        <section className="intro">
          <div>
            <Typography variant="h4">HAR analysis dashboard</Typography>
            <Typography color="textSecondary">
              Inspect HTTP responses, payloads, headers, timing, and failed
              resource loads.
            </Typography>
          </div>
          <div className="upload-wrap">
            <input
              id="har-file"
              type="file"
              accept=".har,application/json,application/har+json"
              onChange={onFile}
              hidden
            />
            <label htmlFor="har-file">
              <Button variant="contained" color="primary" component="span">
                Upload HAR file
              </Button>
            </label>
          </div>
        </section>
        {settingsOpen && (
          <Paper className="settings panel">
            <div className="panel-head">
              <div>
                <Typography variant="h6">Analysis settings</Typography>
                <Typography variant="caption" color="textSecondary">
                  Personalize what appears in your report
                </Typography>
              </div>
              <Button
                className="settings-close"
                variant="contained"
                startIcon={<CloseIcon />}
                onClick={() => setSettingsOpen(false)}
              >
                Close settings
              </Button>
            </div>
            <Grid container spacing={1}>
              {[
                ["show200", "2xx success responses"],
                ["show30x", "3xx redirects"],
                ["show40x", "4xx client errors"],
                ["show50x", "5xx server errors"],
                [
                  "showResources",
                  "Separate resource loading (JS, images, JSON)",
                ],
                ["historyEnabled", "Save uploaded files in session history"],
              ].map(([k, label]) => (
                <Grid item xs={12} sm={6} key={k}>
                  <FormControlLabel
                    control={
                      <Switch
                        color="primary"
                        checked={!!settings[k]}
                        onChange={(e) => updateSetting(k, e.target.checked)}
                      />
                    }
                    label={label}
                  />
                </Grid>
              ))}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Response-body search terms (comma-separated)"
                  helperText="Case-insensitive. Default: -ERR-. Matching entries appear under Body matches."
                  value={settings.searchTerms}
                  onChange={(e) => updateSetting("searchTerms", e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="textSecondary">
                  Turning history off immediately deletes session history. Save
                  settings to keep this choice for future sessions.
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={saveSettings}
                >
                  Save settings
                </Button>
                {saved && <span className="saved"> Settings saved</span>}
              </Grid>
            </Grid>
          </Paper>
        )}
        {error && <Paper className="error-box" role="alert">{error}</Paper>}
        {historyError && (
          <Paper className="error-box" role="alert">
            {historyError}
          </Paper>
        )}
        {!entries.length ? (
          <Paper className="empty panel">
            <div className="upload-icon">
              <CloudUploadIcon />
            </div>
            <Typography variant="h5">
              Upload a HAR file to get started
            </Typography>
            <Typography color="textSecondary">
              Export a .har file from your browser's DevTools Network tab, then
              upload it here. Analysis runs locally in this tab.
            </Typography>
            <label htmlFor="har-file">
              <Button color="primary" variant="outlined" component="span">
                Choose HAR file
              </Button>
            </label>
            <Typography variant="caption" color="textSecondary">
              {fileName || "Supports standard JSON HAR exports"}
            </Typography>
          </Paper>
        ) : (
          <>
            <div className="file-strip">
              <div>
                <span className="file-dot" />
                <b>{fileName}</b>
                <span className="muted">
                  {entries.length.toLocaleString()} requests analyzed
                </span>
              </div>
              <Button
                size="small"
                onClick={() => {
                  setEntries([]);
                  setFileName("");
                  setSelectedId(null);
                  setCompareIds([]);
                  setCompareOpen(false);
                  setResourceQuery("");
                  setResourceTypeFilter("all");
                  setStatusFilter("all");
                  clearRequestFilters();
                }}
              >
                Clear file
              </Button>
            </div>
            <Grid container spacing={2} className="stats">
              {[
                ["Requests", entries.length, "All captured entries"],
                ["2xx success", count("200"), "Successful responses"],
                ["3xx redirects", count("30x"), "Redirect responses"],
                ["4xx client errors", count("40x"), "Client-side failures"],
                ["5xx server errors", count("50x"), "Server-side failures"],
                [
                  "Body matches",
                  matches.length,
                  `Search: ${settings.searchTerms || "none"}`,
                ],
              ].map(([label, value, sub]) => (
                <Grid item xs={6} sm={4} md={2} key={label}>
                  <Card className="stat-card">
                    <CardContent>
                      <Typography variant="caption" color="textSecondary">
                        {label}
                      </Typography>
                      <Typography variant="h4">{value}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        {sub}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
            {settings.showResources && (
              <Paper className="resource-summary panel">
                <div>
                  <Typography variant="subtitle1">Resource loading</Typography>
                  <Typography variant="caption" color="textSecondary">
                    JavaScript, images and JSON resources grouped separately
                  </Typography>
                </div>
                <div className="resource-numbers">
                  <button
                    onClick={() => {
                      setFilter("resource-success");
                      setTab(0);
                    }}
                  >
                    <span className="good-number">{resourceSuccess}</span>
                    <small>Successful loads</small>
                  </button>
                  <button
                    onClick={() => {
                      setFilter("resource-failure");
                      setTab(0);
                    }}
                  >
                    <span className="bad-number">{resourceFailure}</span>
                    <small>Failed loads</small>
                  </button>
                  <button
                    onClick={() => {
                      setFilter("all");
                      setTab(0);
                    }}
                  >
                    <span>
                      {entries.filter((entry) => entry._resource !== "Other").length}
                    </span>
                    <small>Total resources</small>
                  </button>
                </div>
              </Paper>
            )}
            <Paper className="panel results">
              <Tabs
                value={tab}
                onChange={(_, v) => {
                  setTab(v);
                  setFilter(v === 1 ? "search-match" : "all");
                  setResourceTypeFilter("all");
                }}
                indicatorColor="primary"
                textColor="primary"
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label={`All requests (${entries.length})`} />
                <Tab label={`Body matches (${matches.length})`} />
              </Tabs>
              <Divider />
              {tab === 0 && (
                <div
                  className="resource-type-filters"
                  role="group"
                  aria-label="Filter requests by resource type"
                >
                  <button
                    type="button"
                    className={resourceTypeFilter === "all" ? "active" : ""}
                    aria-pressed={resourceTypeFilter === "all"}
                    onClick={() => setResourceTypeFilter("all")}
                  >
                    All <span>{entries.length}</span>
                  </button>
                  {RESOURCE_TYPES.map((type) => {
                    const count = requestTypeCounts[type] || 0;
                    return (
                      <button
                        key={type}
                        type="button"
                        className={resourceTypeFilter === type ? "active" : ""}
                        aria-pressed={resourceTypeFilter === type}
                        onClick={() => setResourceTypeFilter(type)}
                        disabled={count === 0}
                      >
                        {type} <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {tab === 0 && (
                <div className="status-filter-pills" role="group" aria-label="Filter requests by status">
                  {[
                    ["all", "All", entries.length],
                    ["200", "2xx", count("200")],
                    ["30x", "3xx", count("30x")],
                    ["40x", "4xx", count("40x")],
                    ["50x", "5xx", count("50x")],
                  ].map(([value, label, statusCount]) => (
                    <button
                      key={value}
                      type="button"
                      className={statusFilter === value ? `active status-${value}` : `status-${value}`}
                      aria-pressed={statusFilter === value}
                      disabled={statusCount === 0 && value !== "all"}
                      onClick={() => setStatusFilter(value)}
                    >
                      {label} <span>{statusCount}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="filterbar">
                {tab === 0 ? (
                  <>
                    <TextField
                      inputRef={requestSearchRef}
                      size="small"
                      variant="outlined"
                      placeholder="Search requests by URL, method, status, or type..."
                      inputProps={{
                        "aria-label":
                          "Search requests by URL, method, status, or type",
                      }}
                      value={resourceQuery}
                      onChange={(e) => setResourceQuery(e.target.value)}
                    />
                    <Button
                      size="small"
                      aria-label="Clear request search"
                      disabled={!resourceQuery}
                      onClick={() => setResourceQuery("")}
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  <TextField
                    inputRef={requestSearchRef}
                    size="small"
                    variant="outlined"
                    placeholder="Search URL, method, status..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                )}
                <FormControl
                  variant="outlined"
                  size="small"
                  className="status-select"
                >
                  <InputLabel>View</InputLabel>
                  <Select
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setTab(e.target.value === "search-match" ? 1 : 0);
                    }}
                    label="View"
                  >
                    <MenuItem value="all">All visible requests</MenuItem>
                    <MenuItem value="search-match">Body matches</MenuItem>
                    {settings.showResources && (
                      <MenuItem value="resource-success">
                        Successful resources
                      </MenuItem>
                    )}
                    {settings.showResources && (
                      <MenuItem value="resource-failure">
                        Failed resources
                      </MenuItem>
                    )}
                  </Select>
                </FormControl>
                <FormControl
                  variant="outlined"
                  size="small"
                  className="status-select timing-sort-select"
                >
                  <InputLabel>Timing</InputLabel>
                  <Select
                    value={requestSort}
                    onChange={(e) => setRequestSort(e.target.value)}
                    label="Timing"
                  >
                    <MenuItem value="original">Original order</MenuItem>
                    <MenuItem value="slowest">Slowest first</MenuItem>
                    <MenuItem value="fastest">Fastest first</MenuItem>
                  </Select>
                </FormControl>
                {hasActiveRequestFilters && (
                  <Button
                    size="small"
                    className="clear-filters-button"
                    onClick={clearRequestFilters}
                  >
                    Clear all filters
                  </Button>
                )}
                <Button
                  size="small"
                  className="compare-button"
                  disabled={compareIds.length !== 2}
                  onClick={() => setCompareOpen(true)}
                >
                  Compare {compareIds.length ? `(${compareIds.length}/2)` : ""}
                </Button>
                {compareIds.length > 0 && (
                  <>
                    <Button
                      size="small"
                      onClick={() => setCompareIds([])}
                    >
                      Clear selection
                    </Button>
                    <Button
                      size="small"
                      className="export-button"
                      onClick={exportSelected}
                    >
                      Export selected JSON
                    </Button>
                  </>
                )}
                <Button
                  size="small"
                  className="export-button"
                  disabled={!visibleEntries.length}
                  onClick={() => exportRequests("json")}
                >
                  Export JSON
                </Button>
                <Button
                  size="small"
                  className="export-button"
                  disabled={!visibleEntries.length}
                  onClick={() => exportRequests("csv")}
                >
                  Export CSV
                </Button>
                <Typography variant="caption" color="textSecondary">
                  {visibleEntries.length} shown · select a row to inspect
                  details · select two to compare
                </Typography>
              </div>
              <div className="request-list">
                {visibleEntries.length > 0 && visibleEntries.length <= 1000 && (
                  <VirtualList
                    width="100%"
                    height={530}
                    itemCount={visibleEntries.length}
                    itemSize={72}
                    overscanCount={5}
                    renderItem={({ index, style }) => {
                      const entry = visibleEntries[index];
                      return (
                        <div key={entry._id} style={style}>
                          <RequestRow
                            entry={entry}
                            selected={selectedId === entry._id}
                            comparing={compareIds.includes(entry._id)}
                            compareLimitReached={compareIds.length >= 2}
                            terms={terms}
                            maxVisibleTime={maxVisibleTime}
                            onSelect={() => selectRequest(entry._id)}
                            onToggleCompare={() => {
                              setCompareIds((current) =>
                                current.includes(entry._id)
                                  ? current.filter((id) => id !== entry._id)
                                  : current.length < 2 ? [...current, entry._id] : current,
                              );
                              setCompareOpen(false);
                            }}
                          />
                        </div>
                      );
                    }}
                  />
                )}
                {visibleEntries.length > 1000 && (
                  <AutoSizer disableHeight>
                    {({ width }) => (
                      <VirtualizedList
                        width={width}
                        height={530}
                        rowCount={visibleEntries.length}
                        rowHeight={72}
                        overscanRowCount={5}
                        rowRenderer={({ key, index, style }) => {
                          const entry = visibleEntries[index];
                          return (
                            <div key={key} style={style}>
                              <RequestRow
                                entry={entry}
                                selected={selectedId === entry._id}
                                comparing={compareIds.includes(entry._id)}
                                compareLimitReached={compareIds.length >= 2}
                                terms={terms}
                                maxVisibleTime={maxVisibleTime}
                                onSelect={() => selectRequest(entry._id)}
                                onToggleCompare={() => {
                                  setCompareIds((current) =>
                                    current.includes(entry._id)
                                      ? current.filter((id) => id !== entry._id)
                                      : current.length < 2 ? [...current, entry._id] : current,
                                  );
                                  setCompareOpen(false);
                                }}
                              />
                            </div>
                          );
                        }}
                      />
                    )}
                  </AutoSizer>
                )}
                {!visibleEntries.length && (
                  <div className="no-results">No requests match these filters.</div>
                )}
              </div>
            </Paper>
            {compareOpen && compareEntries.length === 2 && (
              <Paper className="panel comparison-panel">
                <div className="detail-heading">
                  <div>
                    <Typography variant="h6">Request comparison</Typography>
                    <Typography variant="caption" color="textSecondary">
                      Side-by-side comparison of the two selected requests
                    </Typography>
                  </div>
                  <Button size="small" onClick={() => setCompareOpen(false)}>Close</Button>
                </div>
                {compareEntries.length === 2 && (
                  <div className={`comparison-body-status ${requestBodiesMatch ? "same" : "different"}`}>
                    Request bodies are <strong>{requestBodiesMatch ? "identical" : "different"}</strong>
                  </div>
                )}
                {compareEntries.length === 2 && (
                  <div className={`comparison-body-status ${responseBodiesMatch ? "same" : "different"}`}>
                    Response bodies are <strong>{responseBodiesMatch ? "identical" : "different"}</strong>
                  </div>
                )}
                <div className="comparison-grid">
                  {compareEntries.map((entry, entryIndex) => (
                    <div className="comparison-column" key={entry._id}>
                      <div className="comparison-summary">
                        <span className="method get">{entry._method}</span>
                        <span className={`status ${isFailedRequest(entry, terms) ? "failed-indicator" : `s${entry._status >= 500 ? 5 : entry._status >= 400 ? 4 : entry._status >= 300 ? 3 : entry._status >= 200 ? 2 : 0}`}`}>
                          {entry._status || "ERR"}
                        </span>
                        <strong>{entry._url}</strong>
                        <Typography variant="caption" color="textSecondary">
                          {fmt(entry._time)} · {entry._resource}
                        </Typography>
                      </div>
                      <div className="comparison-request-body">
                        <DiffPayload
                          title={`Request body${requestBodiesMatch ? " · Same" : " · Different"}`}
                          value={getRequestBody(entry) || "(No request body recorded)"}
                          otherValue={getRequestBody(compareEntries[entryIndex === 0 ? 1 : 0]) || "(No request body recorded)"}
                          side={entryIndex === 0 ? "left" : "right"}
                          copyAdditional={buildCurl(entry)}
                          copyAdditionalLabel="Copy cURL"
                          syncGroup="request-body"
                        />
                      </div>
                      <Payload title="Request headers" value={entry.request?.headers?.map((h) => ({ [h.name]: h.value }))} />
                      <Payload title="Response headers" value={entry.response?.headers?.map((h) => ({ [h.name]: h.value }))} />
                      <DiffPayload
                        title={`Response body${responseBodiesMatch ? " · Same" : " · Different"}`}
                        value={entry.response?.content?.text ?? ""}
                        otherValue={compareEntries[entryIndex === 0 ? 1 : 0].response?.content?.text ?? ""}
                        side={entryIndex === 0 ? "left" : "right"}
                        syncGroup="response-body"
                      />
                    </div>
                  ))}
                </div>
              </Paper>
            )}
            {selected && !compareOpen && (
              <Paper className="panel detail">
                <div className="detail-heading">
                  <div>
                    <Typography variant="h6">Request details</Typography>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      className="detail-url"
                    >
                      {selected._url}
                    </Typography>
                  </div>
                  <Chip
                    size="small"
                    label={`${selected._status || "ERR"} · ${fmt(selected._time)}`}
                    className={
                      isFailedRequest(selected, terms) ? "chip-error" : "chip-ok"
                    }
                  />
                </div>
                <Grid container spacing={2} className="detail-metrics">
                  <Grid item xs={6} sm={3}>
                    <small>Method</small>
                    <b>{selected._method}</b>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <small>Status</small>
                    <b>{selected._status || "No response"}</b>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <small>Total response time</small>
                    <b>{fmt(selected._time)}</b>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <small>Resource type</small>
                    <b>{selected._resource}</b>
                  </Grid>
                </Grid>
                <Divider />
                <Grid container spacing={2} className="payload-grid">
                  <Grid item xs={12} md={6}>
                    <Payload
                      title="Request body"
                      value={getRequestBody(selected) || "(No request body recorded)"}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Payload
                      title="Response body"
                      value={selected._body || "(No response body recorded)"}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Payload
                      title={`Request headers (${selected.request?.headers?.length || 0})`}
                      value={JSON.stringify(
                        selected.request?.headers || [],
                        null,
                        2,
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Payload
                      title={`Response headers (${selected.response?.headers?.length || 0})`}
                      value={JSON.stringify(
                        selected.response?.headers || [],
                        null,
                        2,
                      )}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Payload
                      title="Timing breakdown (ms)"
                      value={JSON.stringify(
                        {
                          blocked: selected.timings?.blocked,
                          dns: selected.timings?.dns,
                          connect: selected.timings?.connect,
                          send: selected.timings?.send,
                          wait: selected.timings?.wait,
                          receive: selected.timings?.receive,
                          ssl: selected.timings?.ssl,
                          total: selected._time,
                        },
                        null,
                        2,
                      )}
                    />
                  </Grid>
                </Grid>
              </Paper>
            )}
          </>
        )}
        <footer>
          HAR Inspector · Files are processed in your browser and are not
          uploaded to a server. HAR files can contain cookies, authorization
          headers and personal data; handle exports carefully.
        </footer>
      </main>
    </div>
  );
}

function Payload({ title, value }) {
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [showFormatted, setShowFormatted] = useState(true);
  const rawText = asText(value);
  const formattedText = formatPayload(value);
  const isJson = isJsonPayload(rawText);
  const text = isJson && showFormatted ? formattedText : rawText;
  const handleCopy = async () => {
    try {
      await copyText(text);
      setCopyStatus("Copied");
    } catch (error) {
      setCopyStatus(
        `Copy failed: ${error.message || "Clipboard access is unavailable."}`,
      );
    }
  };
  return (
    <div className={`payload ${expanded ? "payload-expanded" : ""}`}>
      <div className="payload-title">
        <Typography variant="subtitle2">{title}</Typography>
        {isJson && (
          <div className="payload-view-toggle" aria-label={`${title} display format`}>
            <button
              type="button"
              className={!showFormatted ? "active" : ""}
              aria-pressed={!showFormatted}
              onClick={() => { setShowFormatted(false); setCopyStatus(""); }}
            >
              Raw
            </button>
            <button
              type="button"
              className={showFormatted ? "active" : ""}
              aria-pressed={showFormatted}
              onClick={() => { setShowFormatted(true); setCopyStatus(""); }}
            >
              Formatted
            </button>
          </div>
        )}
        <Button
          size="small"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse" : "Expand"}
        </Button>
        <Button size="small" onClick={handleCopy}>
          {copyStatus === "Copied" ? "Copied" : "Copy"}
        </Button>
        {copyStatus.startsWith("Copy failed:") && (
          <Typography
            className="payload-copy-error"
            variant="caption"
            role="status"
          >
            {copyStatus}
          </Typography>
        )}
      </div>
      <pre className={expanded ? "expanded" : ""}>{text}</pre>
    </div>
  );
}

function DiffPayload({ title, value, otherValue, side, copyAdditional, copyAdditionalLabel, syncGroup }) {
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [curlCopyStatus, setCurlCopyStatus] = useState("");
  const [showFormatted, setShowFormatted] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(-1);
  const [changedOnly, setChangedOnly] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [ignoreKeyOrder, setIgnoreKeyOrder] = useState(false);
  const [ignoreArrayOrder, setIgnoreArrayOrder] = useState(false);
  const [synchronizeScroll, setSynchronizeScroll] = useState(true);
  const syncingScrollRef = useRef(false);
  const rawText = asText(value);
  const formattedText = formatPayload(value);
  const isJson = isJsonPayload(rawText);
  const text = isJson && showFormatted ? formattedText : rawText;

  const otherRawText = asText(otherValue);
  const otherFormattedText = formatPayload(otherValue);
  const otherIsJson = isJsonPayload(otherRawText);
  const otherText = isJson && otherIsJson && showFormatted ? otherFormattedText : otherRawText;
  const comparisonText = ignoreKeyOrder || ignoreArrayOrder
    ? normalizeJsonForDiff(text, ignoreKeyOrder, ignoreArrayOrder)
    : ignoreWhitespace ? text.replace(/[^\S\r\n]+/g, "") : text;
  const otherComparisonText = ignoreKeyOrder || ignoreArrayOrder
    ? normalizeJsonForDiff(otherText, ignoreKeyOrder, ignoreArrayOrder)
    : ignoreWhitespace ? otherText.replace(/[^\S\r\n]+/g, "") : otherText;
  const diff = useMemo(
    () => getLineDiff(
      side === "left" ? comparisonText : otherComparisonText,
      side === "left" ? otherComparisonText : comparisonText,
    ),
    [comparisonText, otherComparisonText, side],
  );
  const changedLines = side === "left"
    ? diff.leftChanged
    : diff.rightChanged;
  const diffTypes = side === "left"
    ? diff.leftTypes
    : diff.rightTypes;
  const lines = text.split("\n");
  const changedLineList = [...changedLines].sort((a, b) => a - b);
  const payloadRef = useRef(null);
  const searchMatches = lines.reduce((matches, line, index) => {
    if (searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase())) matches.push(index);
    return matches;
  }, []);
  const oppositeChangedLines = side === "left"
    ? [...diff.rightChanged].sort((a, b) => a - b)
    : [...diff.leftChanged].sort((a, b) => a - b);
  const otherLines = otherText.split("\n");
  const handleCopy = async () => {
    try {
      await copyText(text);
      setCopyStatus("Copied");
    } catch (error) {
      setCopyStatus(`Copy failed: ${error.message || "Clipboard access is unavailable."}`);
    }
  };

  const copyValue = async (content, label) => {
    try {
      await copyText(content);
      setCopyStatus(label);
    } catch (error) {
      setCopyStatus(`Copy failed: ${error.message || "Clipboard access is unavailable."}`);
    }
  };

  const copyCurl = async () => {
    try {
      await copyText(copyAdditional);
      setCurlCopyStatus("Copied");
      window.setTimeout(() => setCurlCopyStatus(""), 1500);
    } catch (error) {
      setCopyStatus(`Copy failed: ${error.message || "Clipboard access is unavailable."}`);
    }
  };

  const navigateSearch = (direction) => {
    if (!searchMatches.length) return;
    const next = searchCursor < 0
      ? (direction > 0 ? 0 : searchMatches.length - 1)
      : (searchCursor + direction + searchMatches.length) % searchMatches.length;
    setSearchCursor(next);
    window.requestAnimationFrame(() => {
      payloadRef.current
        ?.querySelector(`[data-diff-line="${searchMatches[next]}"]`)
        ?.scrollIntoView({ block: "center" });
    });
  };

  const handleScroll = (event) => {
    if (!synchronizeScroll || syncingScrollRef.current) return;
    const source = event.currentTarget;
    const maxScroll = source.scrollHeight - source.clientHeight;
    const ratio = maxScroll > 0 ? source.scrollTop / maxScroll : 0;
    syncingScrollRef.current = true;
    document.querySelectorAll(`[data-sync-diff="${syncGroup}"]`).forEach((target) => {
      if (target === source) return;
      const targetMaxScroll = target.scrollHeight - target.clientHeight;
      target.scrollTop = targetMaxScroll > 0 ? ratio * targetMaxScroll : 0;
    });
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  };

  const renderDiffLine = (line, index) => {
    if (!changedLines.has(index)) return line || " ";
    const changedIndex = changedLineList.indexOf(index);
    const oppositeIndex = oppositeChangedLines[changedIndex];
    if (oppositeIndex === undefined) return line || " ";
    const characterDiff = getCharacterDiff(line, otherLines[oppositeIndex] || "");
    const [middleStart, middleEnd] = side === "left"
      ? characterDiff.leftMiddle
      : characterDiff.rightMiddle;
    return (
      <>
        {line.slice(0, middleStart)}
        <mark className="diff-character-changed">{line.slice(middleStart, middleEnd) || " "}</mark>
        {line.slice(middleEnd)}
      </>
    );
  };

  return (
    <div className={`payload diff-payload ${expanded ? "payload-expanded" : ""}`}>
      <div className="payload-title">
        <Typography variant="subtitle2">{title}</Typography>
        <TextField
          className="diff-search"
          size="small"
          variant="outlined"
          value={searchQuery}
          placeholder="Find in body"
          aria-label={`Find in ${title}`}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setSearchCursor(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigateSearch(event.shiftKey ? -1 : 1);
          }}
        />
        {searchMatches.length > 0 && (
          <div className="diff-search-navigation">
            <Button size="small" onClick={() => navigateSearch(-1)}>Prev match</Button>
            <Typography variant="caption">
              {searchCursor < 0 ? searchMatches.length : `${searchCursor + 1}/${searchMatches.length}`}
            </Typography>
            <Button size="small" onClick={() => navigateSearch(1)}>Next match</Button>
          </div>
        )}
        {isJson && (
          <div className="payload-view-toggle" aria-label={`${title} display format`}>
            <button type="button" className={!showFormatted ? "active" : ""} aria-pressed={!showFormatted} onClick={() => setShowFormatted(false)}>
              Raw
            </button>
            <button type="button" className={showFormatted ? "active" : ""} aria-pressed={showFormatted} onClick={() => setShowFormatted(true)}>
              Formatted
            </button>
          </div>
        )}
        <Button size="small" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Collapse" : "Expand"}
        </Button>
        <Button size="small" onClick={handleCopy}>
          {copyStatus === "Copied" ? "Copied" : "Copy"}
        </Button>
        {changedLineList.length > 0 && (
          <Button size="small" onClick={() => copyValue(changedLineList.map((index) => lines[index]).join("\n"), "Changed lines copied")}>
            Copy changed
          </Button>
        )}
        {copyAdditional && (
          <Button size="small" onClick={copyCurl}>
            {curlCopyStatus || copyAdditionalLabel}
          </Button>
        )}
        {copyStatus && copyStatus !== "Copied" && copyStatus !== "" && (
          <Typography className={copyStatus.startsWith("Copy failed:") ? "payload-copy-error" : ""} variant="caption" role="status">
            {copyStatus}
          </Typography>
        )}
      </div>
      <div className="diff-options">
        <button type="button" className={changedOnly ? "active" : ""} aria-pressed={changedOnly} onClick={() => setChangedOnly(!changedOnly)}>
          Changed lines only
        </button>
        <button type="button" className={ignoreWhitespace ? "active" : ""} aria-pressed={ignoreWhitespace} onClick={() => setIgnoreWhitespace(!ignoreWhitespace)}>
          Ignore whitespace
        </button>
        {isJson && (
          <>
            <button type="button" className={ignoreKeyOrder ? "active" : ""} aria-pressed={ignoreKeyOrder} onClick={() => setIgnoreKeyOrder(!ignoreKeyOrder)}>
              Ignore JSON key order
            </button>
            <button type="button" className={ignoreArrayOrder ? "active" : ""} aria-pressed={ignoreArrayOrder} onClick={() => setIgnoreArrayOrder(!ignoreArrayOrder)}>
              Ignore array order
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        className={`sync-scroll-toggle ${synchronizeScroll ? "active" : ""}`}
        aria-pressed={synchronizeScroll}
        onClick={() => setSynchronizeScroll(!synchronizeScroll)}
      >
        Synchronized scrolling
      </button>
      <div className="diff-legend" aria-label="Difference legend">
        <span className="diff-legend-added">Added { [...diffTypes.values()].filter((type) => type === "added").length }</span>
        <span className="diff-legend-removed">Removed { [...diffTypes.values()].filter((type) => type === "removed").length }</span>
        <span className="diff-legend-changed">Changed { [...diffTypes.values()].filter((type) => type === "changed").length }</span>
      </div>
      <pre
        ref={payloadRef}
        className={expanded ? "expanded" : ""}
        data-sync-diff={syncGroup}
        onScroll={handleScroll}
      >
        {lines.map((line, index) => changedOnly && !changedLines.has(index) ? null : (
          <React.Fragment key={`${index}-${line}`}>
            <span
              data-diff-line={index}
              className={`diff-line diff-${diffTypes.get(index) || "unchanged"} ${searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase()) ? "diff-search-match" : ""}`}
            >
              {renderDiffLine(line, index)}
            </span>
            {index < lines.length - 1 ? "\n" : ""}
          </React.Fragment>
        ))}
      </pre>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById("root"));
