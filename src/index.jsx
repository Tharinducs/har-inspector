import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import SettingsIcon from "@material-ui/icons/Settings";
import CloseIcon from "@material-ui/icons/Close";
import CloudUploadIcon from "@material-ui/icons/CloudUpload";
import SearchIcon from "@material-ui/icons/Search";
import InsertDriveFileIcon from "@material-ui/icons/InsertDriveFile";
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

const DEFAULTS = {
  show200: true,
  show30x: true,
  show40x: true,
  show50x: true,
  showResources: true,
  searchTerms: "-ERR-",
};

const STATUS_GROUPS = ["200", "30x", "40x", "50x"];

const asText = (v) =>
  v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2);

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

const getHeader = (headers, name) =>
  (headers || []).find(
    (h) => (h.name || "").toLowerCase() === name.toLowerCase(),
  )?.value || "";

const isResource = (e) => {
  const mime = (
    e.response?.content?.mimeType ||
    getHeader(e.response?.headers, "content-type")
  ).toLowerCase();
  const url = (e.request?.url || "").toLowerCase().split("?")[0];
  const ext = (url.match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (
    /javascript|ecmascript|\.m?js$/.test(mime + " " + url) ||
    ["js", "mjs", "cjs"].includes(ext)
  )
    return "JavaScript";
  if (
    /image\//.test(mime) ||
    ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "avif"].includes(ext)
  )
    return "Image";
  if (/json/.test(mime) || ext === "json") return "JSON";
  return "Other";
};

function parseHar(raw) {
  const har = typeof raw === "string" ? JSON.parse(raw) : raw;
  const entries = har?.log?.entries;
  if (!Array.isArray(entries))
    throw new Error(
      "This file does not look like a valid HAR: log.entries was not found.",
    );
  return entries.map((e, i) => ({
    ...e,
    _id: i,
    _status: Number(e.response?.status || 0),
    _body: e.response?.content?.text || "",
    _requestBody: e.request?.postData?.text || "",
    _resource: isResource(e),
    _url: e.request?.url || "(URL unavailable)",
    _method: e.request?.method || "—",
    _time: Number(e.time || 0),
  }));
}

function statusGroup(code) {
  if (code >= 200 && code < 300) return "200";
  if (code >= 300 && code < 400) return "30x";
  if (code >= 400 && code < 500) return "40x";
  if (code >= 500 && code < 600) return "50x";
  return "other";
}

function App() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [entries, setEntries] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  const [tab, setTab] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [resourceQuery, setResourceQuery] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (globalThis.chrome?.storage?.local)
      chrome.storage.local.get("harSettings", (r) =>
        setSettings({ ...DEFAULTS, ...(r.harSettings || {}) }),
      );
  }, []);

  const updateSetting = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaved(false);
  };

  const saveSettings = () => {
    if (globalThis.chrome?.storage?.local)
      chrome.storage.local.set({ harSettings: settings }, () => setSaved(true));
    else setSaved(true);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const parsed = parseHar(await file.text());
      setEntries(parsed);
      setFileName(file.name);
      setSelectedId(parsed[0]?._id ?? null);
      setTab(0);
      setFilter("all");
      setQuery("");
      setResourceQuery("");
    } catch (err) {
      setError(err.message || "Unable to parse this HAR file.");
      setEntries([]);
    }
    e.target.value = "";
  };

  const terms = (settings.searchTerms || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (tab === 2 && e._resource === "Other") return false;
        const group = statusGroup(e._status);
        if (group === "200" && !settings.show200) return false;
        if (group === "30x" && !settings.show30x) return false;
        if (group === "40x" && !settings.show40x) return false;
        if (group === "50x" && !settings.show50x) return false;
        if (
          filter === "resource-success" &&
          !(
            settings.showResources &&
            e._resource !== "Other" &&
            e._status >= 200 &&
            e._status < 400
          )
        )
          return false;
        if (
          filter === "resource-failure" &&
          !(
            settings.showResources &&
            e._resource !== "Other" &&
            (e._status >= 400 || e._status === 0)
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
          tab !== 2 &&
          !`${e._url} ${e._method} ${e._status} ${e._resource}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
          return false;
        if (
          tab === 2 &&
          resourceQuery &&
          !`${e._url} ${e._method} ${e._status} ${e._resource}`
            .toLowerCase()
            .includes(resourceQuery.toLowerCase())
        )
          return false;
        return true;
      }),
    [entries, settings, filter, query, resourceQuery, tab],
  );

  const selected = entries.find((e) => e._id === selectedId);
  const count = (group) =>
    entries.filter((e) => statusGroup(e._status) === group).length;

  const resourceSuccess = entries.filter(
    (e) => e._resource !== "Other" && e._status >= 200 && e._status < 400,
  ).length;
  const resourceFailure = entries.filter(
    (e) => e._resource !== "Other" && (e._status >= 400 || e._status === 0),
  ).length;

  const matches = entries.filter((e) =>
    terms.some((t) => (e._body || "").toLowerCase().includes(t.toLowerCase())),
  );

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
            className={`settings-toggle ${settingsOpen ? "settings-toggle-open" : ""}`}
            startIcon={settingsOpen ? <CloseIcon /> : <SettingsIcon />}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            {settingsOpen ? "Close settings" : "Settings"}
          </Button>
        </Toolbar>
      </AppBar>
      <main className="main">
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
        {error && <Paper className="error-box">{error}</Paper>}
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
                  setResourceQuery("");
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
                      {entries.filter((e) => e._resource !== "Other").length}
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
                }}
                indicatorColor="primary"
                textColor="primary"
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label={`All requests (${entries.length})`} />
                <Tab label={`Body matches (${matches.length})`} />
                <Tab
                  label={`Resource loads (${entries.filter((e) => e._resource !== "Other").length})`}
                />
              </Tabs>
              <Divider />
              <div className="filterbar">
                {tab === 2 ? (
                  <>
                    <TextField
                      size="small"
                      variant="outlined"
                      placeholder="Search resources by URL, method, status, or type..."
                      inputProps={{
                        "aria-label":
                          "Search resources by URL, method, status, or type",
                      }}
                      value={resourceQuery}
                      onChange={(e) => setResourceQuery(e.target.value)}
                    />
                    <Button
                      size="small"
                      aria-label="Clear resource search"
                      disabled={!resourceQuery}
                      onClick={() => setResourceQuery("")}
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  <TextField
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
                <Typography variant="caption" color="textSecondary">
                  {visibleEntries.length} shown · select a row to inspect
                  details
                </Typography>
              </div>
              <div className="request-list">
                {visibleEntries.map((e) => (
                  <button
                    key={e._id}
                    className={`request-row ${selectedId === e._id ? "selected" : ""}`}
                    onClick={() => setSelectedId(e._id)}
                  >
                    <div className="row-main">
                      <span
                        className={`method ${e._method === "GET" ? "get" : "other-method"}`}
                      >
                        {e._method}
                      </span>
                      <span className="url" title={e._url}>
                        {e._url}
                      </span>
                      <span
                        className={`status ${e._status >= 500 ? "s5" : e._status >= 400 ? "s4" : e._status >= 300 ? "s3" : e._status >= 200 ? "s2" : "s0"}`}
                      >
                        {e._status || "ERR"}
                      </span>
                    </div>
                    <div className="row-meta">
                      <span>
                        {e._resource !== "Other" ? e._resource : "Request"}
                      </span>
                      <span>{fmt(e._time)}</span>
                      <span>
                        {e.response?.content?.size ??
                          e.response?.bodySize ??
                          "—"}{" "}
                        bytes
                      </span>
                    </div>
                  </button>
                ))}
                {!visibleEntries.length && (
                  <div className="no-results">
                    No requests match these filters.
                  </div>
                )}
              </div>
            </Paper>
            {selected && (
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
                      selected._status >= 400 ? "chip-error" : "chip-ok"
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
                      value={
                        selected._requestBody ||
                        selected.request?.postData?.params
                          ?.map((p) => `${p.name}=${p.value}`)
                          .join("\n") ||
                        "(No request body recorded)"
                      }
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
  const text = asText(value);
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

ReactDOM.render(<App />, document.getElementById("root"));
