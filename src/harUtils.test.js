const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyRequestType, statusGroup, isFailedRequest } = require("./harUtils");
const {
  formatPayload,
  getRequestBody,
  getLineDiff,
  getCharacterDiff,
  summarizeJsonDifferences,
} = require("./payloadUtils");

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

test("finds changed lines between payloads", () => {
  const diff = getLineDiff("a\nb\nc", "a\nchanged\nc");
  assert.deepEqual([...diff.leftChanged], [1]);
  assert.deepEqual([...diff.rightChanged], [1]);

  const identical = getLineDiff("a\nb", "a\nb");
  assert.equal(identical.leftChanged.size, 0);
  assert.equal(identical.rightChanged.size, 0);

  const added = getLineDiff("a\nc", "a\nb\nc");
  assert.equal(added.rightTypes.get(1), "added");
});

test("finds the changed character range and JSON field differences", () => {
  const characterDiff = getCharacterDiff("value = 1", "value = 2");
  assert.deepEqual(characterDiff.leftMiddle, [8, 9]);
  assert.deepEqual(characterDiff.rightMiddle, [8, 9]);

  const jsonChanges = summarizeJsonDifferences(
    '{"id":1,"name":"old","removed":true}',
    '{"id":1,"name":"new","added":true}',
  );
  assert.deepEqual(
    jsonChanges.map((change) => [change.type, change.path]),
    [["added", "$.added"], ["changed", "$.name"], ["removed", "$.removed"]],
  );
});
