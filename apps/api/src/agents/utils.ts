// ─────────────────────────────────────────────────────────────
// Shared agent utilities
// ─────────────────────────────────────────────────────────────

/**
 * Extract a JSON object from raw LLM output. Handles:
 *   - bare JSON
 *   - ```json fenced blocks
 *   - JSON embedded in prose (first { … } balanced match)
 *
 * On a successful balanced parse, returns the parsed object.
 * If the response is clearly truncated (no balanced object), throws —
 * callers needing tolerant recovery should use `extractJSONTolerant`.
 */
export function extractJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // Fall through to brace matching
      }
    }

    const braceStart = raw.indexOf('{');
    if (braceStart !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = braceStart; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) return JSON.parse(raw.slice(braceStart, i + 1)); }
      }
    }

    throw new Error(`Failed to extract JSON from LLM output (length: ${raw.length})`);
  }
}

/**
 * Heuristic check: does this raw LLM output look truncated?
 *
 * We consider output truncated if:
 *   - It contains `"files":` opener but no balanced top-level `}`
 *   - Trailing characters end mid-string (odd unescaped quotes), or
 *   - Brace depth never returns to zero after the first `{`.
 */
export function looksTruncated(raw: string): boolean {
  const trimmed = raw.trimEnd();
  if (trimmed.length === 0) return true;

  // Strip an optional fenced wrapper to inspect the JSON body.
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const body = fence ? fence[1] : trimmed;

  // If the LLM never even opened a brace, it's not truncated — it's empty/invalid.
  const start = body.indexOf('{');
  if (start === -1) return false;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return false; }
  }
  // Either still inside a string, or never closed all braces -> truncated.
  return depth > 0 || inString;
}

/**
 * Tolerant extraction for builder-style outputs of the form
 *   `{ "files": [ { "path": "...", "content": "..." }, ... ], ... }`.
 *
 * Tries `extractJSON` first. If that fails OR the parsed object is missing
 * `files[]` AND the raw text obviously contains a `files` array, walks the
 * raw string and salvages every COMPLETE `{ path, content }` object before
 * the truncation point.
 *
 * Returns `{ object, truncated, salvagedCount, salvageStopReason, source }`.
 *   - `object` always has a `files[]` array (possibly empty).
 *   - `truncated=true` indicates the caller should retry / chunk the request.
 *   - `salvageStopReason` is non-null when the salvage walker terminated
 *     before reaching the closing `]`. One of:
 *       'no-files-key'     | no `"files":[` substring found in raw text
 *       'no-array-bracket' | found key but no `[`
 *       'malformed-entry'  | hit a non-parseable object mid-array
 *       'truncated-mid-object' | brace count never returned to zero
 *       'eof'              | walker reached end of string
 *   - `source` describes how the object was obtained:
 *       'json'             | plain JSON.parse succeeded
 *       'fenced-json'      | extracted from ```json fence
 *       'brace-balanced'   | first balanced { ... } match
 *       'salvaged-files'   | salvage walker on `"files":[`
 *       'salvaged-root-array' | raw is a top-level `[ {path,content}, ... ]`
 *       'empty'            | nothing parseable
 */
export function extractJSONTolerant(raw: string): {
  object: Record<string, unknown>;
  truncated: boolean;
  salvagedCount: number;
  salvageStopReason: string | null;
  source: string;
} {
  // Fast path — well-formed output.
  try {
    const obj = extractJSON(raw);
    // Root array: `[ {path,content}, ... ]` — wrap into { files: ... } so
    // downstream code finds it. Previously this case returned an object
    // with no `files` key and the entire response was silently dropped.
    if (Array.isArray(obj as unknown)) {
      return {
        object: { files: obj as unknown as unknown[] },
        truncated: false,
        salvagedCount: 0,
        salvageStopReason: null,
        source: 'salvaged-root-array',
      };
    }
    return { object: obj, truncated: false, salvagedCount: 0, salvageStopReason: null, source: 'json' };
  } catch {
    // Fall through to salvage.
  }

  const truncated = looksTruncated(raw);
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const body = fence ? fence[1] : raw;

  // Locate the start of the files array.
  const filesKey = body.search(/"files"\s*:\s*\[/);
  if (filesKey === -1) {
    return {
      object: { files: [] },
      truncated,
      salvagedCount: 0,
      salvageStopReason: 'no-files-key',
      source: 'empty',
    };
  }
  const arrStart = body.indexOf('[', filesKey);
  if (arrStart === -1) {
    return {
      object: { files: [] },
      truncated,
      salvagedCount: 0,
      salvageStopReason: 'no-array-bracket',
      source: 'empty',
    };
  }
  const { files: salvaged, stopReason } = salvageFileObjects(body, arrStart + 1);

  return {
    object: { files: salvaged, _truncated: true },
    truncated: true,
    salvagedCount: salvaged.length,
    salvageStopReason: stopReason,
    source: 'salvaged-files',
  };
}

/**
 * Walk forward from `from` inside the raw text and collect every complete
 * `{ ... }` object that contains both a `path` and a `content` string.
 * Stops at the first incomplete object or the end of the string.
 */
function salvageFileObjects(
  body: string,
  from: number,
): { files: Array<{ path: string; content: string; language?: string }>; stopReason: string } {
  const out: Array<{ path: string; content: string; language?: string }> = [];
  let i = from;
  let stopReason = 'eof';
  while (i < body.length) {
    // Skip whitespace and commas between objects.
    while (i < body.length && (body[i] === ' ' || body[i] === '\n' || body[i] === '\r' || body[i] === '\t' || body[i] === ',')) i++;
    if (i >= body.length) { stopReason = 'eof'; break; }
    if (body[i] === ']') { stopReason = 'closing-bracket'; break; }
    if (body[i] !== '{') { stopReason = 'unexpected-char'; break; }

    // Find the balanced closing brace for this object.
    const objStart = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    let objEnd = -1;
    for (let j = i; j < body.length; j++) {
      const ch = body[j];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { objEnd = j; break; } }
    }
    if (objEnd === -1) { stopReason = 'truncated-mid-object'; break; }

    const slice = body.slice(objStart, objEnd + 1);
    try {
      const parsed = JSON.parse(slice) as Record<string, unknown>;
      if (typeof parsed.path === 'string' && typeof parsed.content === 'string') {
        const file: { path: string; content: string; language?: string } = {
          path: parsed.path,
          content: parsed.content,
        };
        if (typeof parsed.language === 'string') file.language = parsed.language;
        out.push(file);
      }
    } catch {
      // Skip malformed entry and stop — likely the truncation point.
      stopReason = 'malformed-entry';
      break;
    }
    i = objEnd + 1;
  }
  return { files: out, stopReason };
}
