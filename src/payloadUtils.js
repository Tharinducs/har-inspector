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

const getLineDiff = (leftText, rightText) => {
  const leftLines = asText(leftText).split("\n");
  const rightLines = asText(rightText).split("\n");
  const leftChanged = new Set();
  const rightChanged = new Set();
  const leftTypes = new Map();
  const rightTypes = new Map();

  const maxDiffLines = 1500;
  if (leftLines.length > maxDiffLines || rightLines.length > maxDiffLines) {
    let prefix = 0;
    while (
      prefix < leftLines.length &&
      prefix < rightLines.length &&
      leftLines[prefix] === rightLines[prefix]
    ) prefix++;

    let leftEnd = leftLines.length - 1;
    let rightEnd = rightLines.length - 1;
    while (
      leftEnd >= prefix &&
      rightEnd >= prefix &&
      leftLines[leftEnd] === rightLines[rightEnd]
    ) {
      leftEnd--;
      rightEnd--;
    }

    for (let index = prefix; index <= leftEnd; index++) leftChanged.add(index);
    for (let index = prefix; index <= rightEnd; index++) rightChanged.add(index);
    for (let index = prefix; index <= leftEnd; index++) leftTypes.set(index, "changed");
    for (let index = prefix; index <= rightEnd; index++) rightTypes.set(index, "changed");
    return { leftChanged, rightChanged, leftTypes, rightTypes };
  }

  const rows = leftLines.length + 1;
  const columns = rightLines.length + 1;
  const lengths = new Uint16Array(rows * columns);

  for (let left = leftLines.length - 1; left >= 0; left--) {
    for (let right = rightLines.length - 1; right >= 0; right--) {
      const index = left * columns + right;
      lengths[index] = leftLines[left] === rightLines[right]
        ? lengths[(left + 1) * columns + right + 1] + 1
        : Math.max(lengths[(left + 1) * columns + right], lengths[left * columns + right + 1]);
    }
  }

  const matchingLeft = new Set();
  const matchingRight = new Set();
  let left = 0;
  let right = 0;
  while (left < leftLines.length && right < rightLines.length) {
    if (leftLines[left] === rightLines[right]) {
      matchingLeft.add(left);
      matchingRight.add(right);
      left++;
      right++;
    } else if (
      lengths[(left + 1) * columns + right] >= lengths[left * columns + right + 1]
    ) {
      left++;
    } else {
      right++;
    }
  }

  leftLines.forEach((_, index) => {
    if (!matchingLeft.has(index)) leftChanged.add(index);
  });
  rightLines.forEach((_, index) => {
    if (!matchingRight.has(index)) rightChanged.add(index);
  });

  let operationLeft = 0;
  let operationRight = 0;
  const operations = [];
  while (operationLeft < leftLines.length || operationRight < rightLines.length) {
    if (
      operationLeft < leftLines.length &&
      operationRight < rightLines.length &&
      leftLines[operationLeft] === rightLines[operationRight]
    ) {
      operations.push({ type: "equal", left: operationLeft, right: operationRight });
      operationLeft++;
      operationRight++;
    } else if (
      operationRight >= rightLines.length ||
      (
        operationLeft < leftLines.length &&
        lengths[(operationLeft + 1) * columns + operationRight] >=
          lengths[operationLeft * columns + operationRight + 1]
      )
    ) {
      operations.push({ type: "delete", left: operationLeft });
      operationLeft++;
    } else {
      operations.push({ type: "insert", right: operationRight });
      operationRight++;
    }
  }

  for (let index = 0; index < operations.length;) {
    if (operations[index].type === "equal") {
      index++;
      continue;
    }

    const block = [];
    while (index < operations.length && operations[index].type !== "equal") {
      block.push(operations[index++]);
    }
    const deleted = block.filter((operation) => operation.type === "delete");
    const inserted = block.filter((operation) => operation.type === "insert");
    const pairedCount = Math.min(deleted.length, inserted.length);

    deleted.forEach((operation, offset) => {
      leftChanged.add(operation.left);
      leftTypes.set(operation.left, offset < pairedCount ? "changed" : "removed");
    });
    inserted.forEach((operation, offset) => {
      rightChanged.add(operation.right);
      rightTypes.set(operation.right, offset < pairedCount ? "changed" : "added");
    });
  }

  return { leftChanged, rightChanged, leftTypes, rightTypes };
};

const getCharacterDiff = (leftText, rightText) => {
  const left = asText(leftText);
  const right = asText(rightText);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;

  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }

  return {
    prefix: start,
    leftMiddle: [start, leftEnd],
    rightMiddle: [start, rightEnd],
  };
};

const summarizeJsonDifferences = (leftValue, rightValue) => {
  const parse = (value) => {
    try {
      return JSON.parse(asText(value));
    } catch {
      return null;
    }
  };
  const left = parse(leftValue);
  const right = parse(rightValue);
  const changes = [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return changes;

  const paths = new Set();
  const collect = (value, path = "$") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    Object.entries(value).forEach(([key, child]) => {
      const childPath = `${path}.${key}`;
      paths.add(childPath);
      collect(child, childPath);
    });
  };
  collect(left);
  collect(right);

  const valueAt = (root, path) => path.split(".").slice(1).reduce(
    (value, key) => value?.[key],
    root,
  );

  [...paths].sort().forEach((path) => {
    const leftValueAtPath = valueAt(left, path);
    const rightValueAtPath = valueAt(right, path);
    const inLeft = leftValueAtPath !== undefined;
    const inRight = rightValueAtPath !== undefined;
    if (inLeft && !inRight) changes.push({ type: "removed", path, left: leftValueAtPath });
    else if (!inLeft && inRight) changes.push({ type: "added", path, right: rightValueAtPath });
    else if (JSON.stringify(leftValueAtPath) !== JSON.stringify(rightValueAtPath)) {
      changes.push({ type: "changed", path, left: leftValueAtPath, right: rightValueAtPath });
    }
  });
  return changes;
};

module.exports = {
  asText,
  formatPayload,
  getRequestBody,
  getLineDiff,
  getCharacterDiff,
  summarizeJsonDifferences,
};
