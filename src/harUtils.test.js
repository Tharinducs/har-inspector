const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyRequestType, statusGroup, isFailedRequest } = require("./harUtils");
const { formatPayload, getRequestBody } = require("./payloadUtils");

test("classifies request resources from HAR type before MIME fallbacks", () => {
  assert.equal(classifyRequestType({ request: { url: "https://example.com/api" }, response: { content: { mimeType: "application/json" } }, _resourceType: "xhr" }), "Fetch/XHR");
  assert.equal(classifyRequestType({ request: { url: "https://example.com/app.js" }, response: { content: { mimeType: "text/plain" } } }), "JS");
  assert.equal(classifyRequestType({ request: { url: "https://example.com/image.PNG" }, response: { content: { mimeType: "application/octet-stream" } } }), "Image");
});

test("groups HTTP statuses into inspector buckets", () => {
  assert.equal(statusGroup(204), "200");
  assert.equal(statusGroup(304), "30x");
  assert.equal(statusGroup(404), "40x");
  assert.equal(statusGroup(503), "50x");
});

test("detects configured response failure markers", () => {
  assert.equal(isFailedRequest({ _status: 200, _body: "request failed: -ERR-invalid" }, ["-ERR-"]), true);
  assert.equal(isFailedRequest({ _status: 200, _body: "ok" }, ["-ERR-"]), false);
});

test("formats JSON payloads and safely preserves malformed JSON", () => {
  assert.equal(formatPayload('{"answer":42,"items":[1,2]}'), '{\n  "answer": 42,\n  "items": [\n    1,\n    2\n  ]\n}');
  assert.equal(formatPayload('{"broken"'), '{"broken"');
});

test("extracts request body text or form parameters", () => {
  assert.equal(getRequestBody({ request: { postData: { text: '{"a":1}' } } }), '{"a":1}');
  assert.equal(getRequestBody({ request: { postData: { params: [{ name: "a", value: "1" }, { name: "b", value: "2" }] } } }), "a=1\nb=2");
});
