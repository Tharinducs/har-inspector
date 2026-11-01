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

async function parseHar(raw, onProgress = () => {}) {
  const har = typeof raw === "string" ? JSON.parse(raw) : raw;
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("This file does not look like a valid HAR: log.entries was not found.");

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
  parseHar,
};
