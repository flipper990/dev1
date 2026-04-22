// ─────────────────────────────────────────────────────────────
// Shared agent utilities
// ─────────────────────────────────────────────────────────────

/**
 * Extract a JSON object from raw LLM output. Handles:
 *   - bare JSON
 *   - ```json fenced blocks
 *   - JSON embedded in prose (first { … } balanced match)
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
