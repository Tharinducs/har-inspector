const asText = (value) =>
  value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);

const formatPayload = (value) => {
  const text = asText(value);
  try {
    if (typeof value !== "string") return JSON.stringify(value, null, 2);
    const trimmed = text.trim();
    if (!trimmed || !["{", "["].includes(trimmed[0])) return text;
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? formatPayload(parsed) : JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
};

const getRequestBody = (entry) => {
  const postData = entry?.request?.postData;
  if (postData?.text) return postData.text;
  if (postData?.params?.length) {
    return postData.params.map((param) => `${param.name}=${param.value ?? ""}`).join("\n");
  }
  return entry?._requestBody || "";
};

module.exports = { asText, formatPayload, getRequestBody };
