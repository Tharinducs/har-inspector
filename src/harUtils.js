const RESOURCE_TYPES = [
  "Fetch/XHR", "Document", "CSS", "JS", "Font", "Image",
  "Media", "Manifest", "WebSocket", "Wasm", "Other",
];

const getHeader = (headers, name) =>
  (headers || []).find((header) =>
    String(header.name || "").toLowerCase() === String(name).toLowerCase(),
  )?.value || "";

const classifyRequestType = (entry) => {
  const mime = (
    entry.response?.content?.mimeType ||
    getHeader(entry.response?.headers, "content-type") || ""
  ).toLowerCase();
  const url = String(entry.request?.url || "").toLowerCase().split("?")[0];
  const ext = (url.match(/\.([a-z0-9]+)$/) || [])[1] || "";
  const harType = String(
    entry._resourceType || entry.resourceType || entry._type || entry.type || "",
  ).toLowerCase().replace(/[^a-z0-9]+/g, "_");

  if (["xhr", "fetch", "xmlhttprequest"].includes(harType)) return "Fetch/XHR";
  if (["websocket", "web_socket"].includes(harType) || mime.includes("websocket")) return "WebSocket";
  if (["wasm", "webassembly"].includes(harType) || /\bwasm\b/.test(mime) || ext === "wasm") return "Wasm";
  if (["document", "main_frame", "mainframe", "sub_frame", "subframe", "html"].includes(harType)) return "Document";
  if (["script", "javascript", "js"].includes(harType) || /javascript|ecmascript/.test(mime) || ["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) return "JS";
  if (["stylesheet", "css"].includes(harType) || /text\/css/.test(mime) || ext === "css") return "CSS";
  if (harType === "image" || /image\//.test(mime) || ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "avif", "bmp"].includes(ext)) return "Image";
  if (harType === "font" || /font\/|application\/\w*font|woff|opentype/.test(mime) || ["woff", "woff2", "ttf", "otf", "eot"].includes(ext)) return "Font";
  if (["media", "audio", "video"].includes(harType) || /\b(audio|video)\//.test(mime) || ["mp4", "webm", "m4a", "mp3", "ogg", "mov", "wav", "flac", "aac"].includes(ext)) return "Media";
  if (harType === "manifest" || /webmanifest|manifest/.test(mime) || ext === "webmanifest") return "Manifest";
  if (/json/.test(mime) || ext === "json") return "Fetch/XHR";

  const method = String(entry.request?.method || "GET").toUpperCase();
  const hasRequestBody = Boolean(entry.request?.postData?.text) || Boolean(entry.request?.postData?.params?.length);
  const acceptsJson = String(getHeader(entry.request?.headers, "accept")).toLowerCase().includes("json");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && (hasRequestBody || acceptsJson)) return "Fetch/XHR";
  if (/text\/html|application\/xhtml/.test(mime) || ["html", "htm"].includes(ext)) return "Document";
  return "Other";
};

const classifyResource = (entry) => {
  const type = classifyRequestType(entry);
  const mime = (
    entry.response?.content?.mimeType ||
    getHeader(entry.response?.headers, "content-type") || ""
  ).toLowerCase();
  const url = String(entry.request?.url || "").toLowerCase().split("?")[0];
  const ext = (url.match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (type === "JS") return "JavaScript";
  if (type === "Image") return "Image";
  if (/json/.test(mime) || ext === "json") return "JSON";
  return "Other";
};

const statusGroup = (code) => {
  if (code >= 200 && code < 300) return "200";
  if (code >= 300 && code < 400) return "30x";
  if (code >= 400 && code < 500) return "40x";
  if (code >= 500 && code < 600) return "50x";
  return "other";
};

const hasFailureIndicator = (entry, terms = []) =>
  terms.some((term) => String(entry._body || "").toLowerCase().includes(String(term).toLowerCase()));

const isFailedRequest = (entry, terms = []) =>
  entry._status >= 400 || entry._status === 0 || hasFailureIndicator(entry, terms);

const normalizeEndpointPath = (pathname, ignoreIds = true) => pathname
  .split("/")
  .map((segment) => {
    if (!ignoreIds) return segment;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return "{uuid}";
    if (/^\d+$/.test(segment) || /^[0-9a-f]{24}$/i.test(segment)) return "{id}";
    return segment;
  })
  .join("/");

const getUrlHostnameCounts = (entries) => {
  const counts = {};
  entries.forEach((entry) => {
    try {
      const hostname = new URL(entry.request?.url || entry._url || "").hostname;
      if (hostname) counts[hostname] = (counts[hostname] || 0) + 1;
    } catch {
      counts["(invalid URL)"] = (counts["(invalid URL)"] || 0) + 1;
    }
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const getHarWarnings = (entries) => {
  const warnings = [];
  entries.forEach((entry, index) => {
    if (!entry.request?.url && !entry._url) warnings.push({ type: "missing-url", index, message: "Request URL is missing." });
    if (!entry.response) warnings.push({ type: "missing-response", index, message: "Response data is missing." });
    else if (entry.response.status === 0) warnings.push({ type: "failed-request", index, message: "Request ended before an HTTP response was received." });
    else if (entry.response.content?.size < 0) warnings.push({ type: "truncated-content", index, message: "Response size is marked as truncated." });
    else if (entry.response.content?.text === "" && (entry.response.content?.size || 0) > 0) {
      warnings.push({ type: "missing-body", index, message: "Response body size is present, but body text is missing." });
    }
    if (entry.response?.redirectURL) warnings.push({ type: "redirect", index, message: `Redirects to ${entry.response.redirectURL}` });
  });
  return warnings;
};

const getPerformanceSummary = (entries) => {
  const timings = entries.map((entry) => ({
    url: entry._url || entry.request?.url || "",
    time: Number(entry._time || 0),
    size: Number(entry.response?.content?.size || entry.response?.bodySize || 0),
  }));
  return {
    requestCount: entries.length,
    totalDuration: timings.reduce((sum, item) => sum + item.time, 0),
    totalSize: timings.reduce((sum, item) => sum + item.size, 0),
    slowest: [...timings].sort((a, b) => b.time - a.time).slice(0, 5),
  };
};

const getDuplicateEndpoints = (entries, options = {}) => {
  const groups = {};
  entries.forEach((entry) => {
    const key = getEndpointKey(entry, options);
    (groups[key] ||= []).push(entry);
  });
  return Object.entries(groups).filter(([, group]) => group.length > 1).sort((a, b) => b[1].length - a[1].length);
};

const redactSensitiveData = (value) => typeof value === "string"
  ? value
    .replace(/(authorization\s*[:=]\s*)[^\s,]+/gi, "$1[REDACTED]")
    .replace(/((?:password|token|api[_-]?key|cookie)\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
  : value;

const getEndpointKey = (entry, options = {}) => {
  try {
    const url = new URL(entry.request?.url || entry._url || "");
    const method = String(entry.request?.method || entry._method || "GET").toUpperCase();
    const query = options.ignoreQuery
      ? []
      : [...new Set([...new URLSearchParams(url.search).entries()]
        .map(([key, value]) => options.ignoreQueryValues === false ? `${key}=${value}` : key)
        .sort())];
    return `${method} ${normalizeEndpointPath(url.pathname, options.ignoreIds !== false)}${query.length ? `?${query.join("&")}` : ""}`;
  } catch {
    const method = String(entry.request?.method || entry._method || "GET").toUpperCase();
    return `${method} ${String(entry.request?.url || entry._url || "").split("?")[0]}`;
  }
};

const getCommonEndpointKeys = (leftEntries, rightEntries, options = {}) => {
  const rightKeys = new Set(rightEntries.map((entry) => getEndpointKey(entry, options)));
  return new Set(leftEntries.map((entry) => getEndpointKey(entry, options)).filter((key) => rightKeys.has(key)));
};

const entryFingerprint = (entry) => JSON.stringify({
  status: entry._status,
  requestBody: entry.request?.postData?.text || entry._requestBody || "",
  responseBody: entry.response?.content?.text || "",
  method: entry._method,
});

const getComparisonStatus = (entry, entries, side, otherEntries, options = {}) => {
  const key = getEndpointKey(entry, options);
  const peers = entries.filter((candidate) => getEndpointKey(candidate, options) === key);
  const otherPeers = otherEntries.filter((candidate) => getEndpointKey(candidate, options) === key);
  if (!otherPeers.length) return side === "left" ? "removed" : "added";
  const index = peers.indexOf(entry);
  const counterpart = otherPeers[Math.min(Math.max(index, 0), otherPeers.length - 1)];
  return entryFingerprint(entry) === entryFingerprint(counterpart) ? "unchanged" : "changed";
};

const getPairedEntries = (entries, otherEntries, options = {}) => {
  const used = new Set();
  const pairs = [];
  entries.forEach((entry) => {
    const key = getEndpointKey(entry, options);
    const counterpart = otherEntries.find((candidate, index) =>
      !used.has(index) && getEndpointKey(candidate, options) === key,
    );
    if (!counterpart) return;
    const counterpartIndex = otherEntries.indexOf(counterpart);
    used.add(counterpartIndex);
    pairs.push([entry, counterpart]);
  });
  return pairs;
};

async function parseHar(raw, onProgress = () => {}) {
  let har;
  try {
    har = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid HAR JSON: ${error.message}`);
    }
    throw error;
  }
  if (!har || typeof har !== "object" || Array.isArray(har)) {
    throw new Error("Invalid HAR file: expected a JSON object.");
  }
  if (!har.log || typeof har.log !== "object" || Array.isArray(har.log)) {
    throw new Error("Invalid HAR file: the log object was not found.");
  }
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("This file does not look like a valid HAR: log.entries was not found.");
  const invalidEntryIndex = entries.findIndex((entry) =>
    !entry || typeof entry !== "object" || Array.isArray(entry),
  );
  if (invalidEntryIndex !== -1) {
    throw new Error(`Invalid HAR file: log.entries[${invalidEntryIndex}] must be an object.`);
  }
  entries.forEach((entry, index) => {
    ["request", "response"].forEach((section) => {
      const value = entry[section];
      if (value != null && (typeof value !== "object" || Array.isArray(value))) {
        throw new Error(`Invalid HAR file: log.entries[${index}].${section} must be an object.`);
      }
      if (value?.headers != null && !Array.isArray(value.headers)) {
        throw new Error(`Invalid HAR file: log.entries[${index}].${section}.headers must be an array.`);
      }
    });
  });

  const parsedEntries = [];
  for (let index = 0; index < entries.length; index += 500) {
    const batch = entries.slice(index, index + 500).map((entry, batchIndex) => ({
      ...entry,
      _id: index + batchIndex,
      _status: Number(entry.response?.status || 0),
      _body: entry.response?.content?.text || "",
      _requestBody: entry.request?.postData?.text || "",
      _requestType: classifyRequestType(entry),
      _resource: classifyResource(entry),
      _url: entry.request?.url || "(URL unavailable)",
      _method: entry.request?.method || "—",
      _time: Number(entry.time || 0),
    }));
    parsedEntries.push(...batch);
    onProgress(Math.min(100, Math.round((parsedEntries.length / entries.length) * 100)));
    await new Promise((resolve) => {
      if (typeof window !== "undefined" && window.setTimeout) window.setTimeout(resolve, 0);
      else setTimeout(resolve, 0);
    });
  }
  return parsedEntries;
}

module.exports = {
  RESOURCE_TYPES,
  classifyRequestType,
  classifyResource,
  getHeader,
  statusGroup,
  hasFailureIndicator,
  isFailedRequest,
  normalizeEndpointPath,
  getEndpointKey,
  getCommonEndpointKeys,
  getComparisonStatus,
  getPairedEntries,
  getUrlHostnameCounts,
  getHarWarnings,
  getPerformanceSummary,
  getDuplicateEndpoints,
  redactSensitiveData,
  parseHar,
};
