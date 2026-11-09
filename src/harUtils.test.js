const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyRequestType,
  statusGroup,
  isFailedRequest,
  getEndpointKey,
  getCommonEndpointKeys,
  getComparisonStatus,
  getPairedEntries,
  parseHar,
} = require("./harUtils");
const {
  formatPayload,
  isJsonPayload,
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

test("normalizes endpoints when finding APIs shared by two HAR files", () => {
  const left = { request: { method: "GET", url: "https://api.example.com/users/123?include=profile&source=one" } };
  const right = { request: { method: "GET", url: "https://staging.example.com/users/456?source=two&include=profile" } };
  assert.equal(getEndpointKey(left), "GET /users/{id}?include&source");
  assert.deepEqual([...getCommonEndpointKeys([left], [right])], ["GET /users/{id}?include&source"]);
});

test("normalizes common path IDs and optionally distinguishes query values", () => {
  const left = { request: { url: "https://api.example.com/users/123?active=true" } };
  const otherQueryValue = { request: { url: "https://api.example.com/users/456?active=false" } };
  const uuid = { request: { url: "https://api.example.com/users/550e8400-e29b-41d4-a716-446655440000?active=false" } };
  const objectId = { request: { url: "https://api.example.com/users/507f1f77bcf86cd799439011?active=true" } };
  assert.equal(getEndpointKey(left), "GET /users/{id}?active");
  assert.equal(getEndpointKey(uuid), "GET /users/{uuid}?active");
  assert.equal(getEndpointKey(objectId), "GET /users/{id}?active");
  assert.equal(getEndpointKey(left, { ignoreQueryValues: false }), "GET /users/{id}?active=true");
  assert.notEqual(
    getEndpointKey(left, { ignoreQueryValues: false }),
    getEndpointKey(otherQueryValue, { ignoreQueryValues: false }),
  );
  assert.equal(getEndpointKey(left, { ignoreQuery: true }), "GET /users/{id}");
  assert.equal(getCommonEndpointKeys([left], [otherQueryValue]).size, 1);
  assert.equal(getCommonEndpointKeys([left], [otherQueryValue], { ignoreQueryValues: false }).size, 0);
  assert.equal(getPairedEntries([left], [otherQueryValue], { ignoreQueryValues: false }).length, 0);
  assert.equal(
    getComparisonStatus(left, [left], "left", [otherQueryValue], { ignoreQueryValues: false }),
    "removed",
  );
});

test("pairs shared endpoints and labels added, removed, and changed requests", () => {
  const base = [
    { request: { method: "GET", url: "https://base.example/users/123" }, response: { status: 200, content: { text: '{"ok":true}' } }, _method: "GET", _status: 200 },
    { request: { method: "GET", url: "https://base.example/removed" }, response: { status: 200 }, _method: "GET", _status: 200 },
  ];
  const updated = [
    { request: { method: "GET", url: "https://updated.example/users/456" }, response: { status: 503, content: { text: '{"ok":false}' } }, _method: "GET", _status: 503 },
    { request: { method: "GET", url: "https://updated.example/added" }, response: { status: 200 }, _method: "GET", _status: 200 },
  ];
  assert.equal(getPairedEntries(base, updated).length, 1);
  assert.equal(getComparisonStatus(base[0], base, "left", updated), "changed");
  assert.equal(getComparisonStatus(base[1], base, "left", updated), "removed");
  assert.equal(getComparisonStatus(updated[1], updated, "right", base), "added");
});

test("reports clear errors for malformed HAR JSON and entries", async () => {
  await assert.rejects(parseHar("{"), /Invalid HAR JSON:/);
  await assert.rejects(parseHar({}), /log object was not found/);
  await assert.rejects(parseHar({ log: { entries: [null] } }), /log\.entries\[0\] must be an object/);
  await assert.rejects(parseHar({ log: { entries: [{ request: { headers: {} } }] } }), /request\.headers must be an array/);
  assert.deepEqual(await parseHar({ log: { entries: [] } }), []);
});

test("formats JSON payloads and safely preserves malformed JSON", () => {
  assert.equal(formatPayload('{"answer":42,"items":[1,2]}'), '{\n  "answer": 42,\n  "items": [\n    1,\n    2\n  ]\n}');
  assert.equal(formatPayload('{"broken"'), '{"broken"');
  assert.equal(isJsonPayload('{\n  "answer": 42\n}'), true);
  assert.equal(isJsonPayload('[1, 2]'), true);
  assert.equal(isJsonPayload('{"broken"'), false);
  assert.equal(isJsonPayload("plain text"), false);
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
