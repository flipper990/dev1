// ─────────────────────────────────────────────────────────────
// Slice planner — turns spec.featureSlices (free-form, possibly
// oversized + un-ordered) into a strict execution plan for the
// per-slice builder loop.
//
// Three responsibilities:
//
//   1. SIZE — split any slice with > MAX_FEATURES_PER_SLICE deliverables
//      (routes + apiIds + components + dbTables) into smaller sub-slices.
//      Smaller slices = smaller prompts = less truncation, fewer QA
//      issues per iteration, faster convergence.
//
//   2. ORDER — topologically sort by `dependsOn` (when provided) PLUS a
//      canonical priority (auth → users → core → interactions → notif →
//      search → settings → extras). Auto-infer dependencies from known
//      slice ids when `dependsOn` is missing so a spec that forgets to
//      declare them is still ordered correctly.
//
//   3. CONTEXT — emit a per-slice context summary (slice manifest) so
//      later slices get a stable cross-reference to what earlier slices
//      built (their key routes, models, components) without needing to
//      re-read every file. Smaller, sharper context = better generation.
//
// All exports are pure functions. Zero LLM cost.
// ─────────────────────────────────────────────────────────────

/** Hard cap on deliverables per slice before we split it. */
export const MAX_FEATURES_PER_SLICE = 5;
/** Soft cap below which a slice is "small enough to leave alone". */
export const SOFT_FEATURES_PER_SLICE = 3;

/**
 * Canonical build order. Slices not in this list (domain-specific) sort
 * after the known ones by spec-supplied position, but always after their
 * declared `dependsOn` predecessors.
 */
export const CANONICAL_SLICE_PRIORITY: readonly string[] = Object.freeze([
  'auth', 'authentication', 'login', 'register', 'session',
  'users', 'user', 'profile', 'profiles', 'accounts',
  'feed', 'posts', 'post', 'content', 'articles', 'listings', 'projects', 'threads',
  'comments', 'replies', 'likes', 'reactions', 'follows', 'subscriptions', 'ratings', 'reviews',
  'notifications', 'inbox',
  'search', 'discovery',
  'settings', 'preferences',
]);

/** Default dependency edges for well-known slice ids. */
const CANONICAL_DEPENDENCIES: Record<string, readonly string[]> = {
  users: ['auth'],
  user: ['auth'],
  profile: ['auth', 'users'],
  profiles: ['auth', 'users'],
  accounts: ['auth'],

  feed: ['users', 'posts'],
  posts: ['users'],
  post: ['users'],
  content: ['users'],
  articles: ['users'],
  listings: ['users'],
  projects: ['users'],
  threads: ['users'],

  comments: ['users', 'posts'],
  replies: ['users', 'posts', 'comments'],
  likes: ['users', 'posts'],
  reactions: ['users', 'posts'],
  follows: ['users'],
  subscriptions: ['users'],
  ratings: ['users', 'posts'],
  reviews: ['users', 'posts'],

  notifications: ['users', 'posts'],
  inbox: ['users'],

  search: ['posts', 'users'],
  discovery: ['posts', 'users'],

  settings: ['users'],
  preferences: ['users'],
};

// ── Types ─────────────────────────────────────────────────────

export interface RawSlice {
  id: string;
  purpose?: string;
  routes?: string[];
  apiIds?: string[];
  dbTables?: string[];
  components?: string[];
  acceptance?: string[];
  /** Optional explicit deps. When missing we infer from CANONICAL_DEPENDENCIES. */
  dependsOn?: string[];
  [key: string]: unknown;
}

export interface PlannedSlice extends RawSlice {
  /** Stable id assigned by the planner — guaranteed unique even after splits. */
  plannedId: string;
  /** When the spec slice was split, which sub-batch is this? (1-indexed) */
  splitIndex: number;
  /** Total sub-batches the original slice was split into (1 if not split). */
  splitTotal: number;
  /** Original spec-level slice id (parent before splitting). */
  parentId: string;
  /** Resolved dependencies in plannedId space. */
  resolvedDeps: string[];
}

export interface SlicePlan {
  /** Final ordered slices ready for the builder loop. */
  slices: PlannedSlice[];
  /** Diagnostics about what we did (logged by the pipeline). */
  notes: string[];
}

// ── Public API ────────────────────────────────────────────────

/**
 * Plan the slice execution sequence:
 *   1. split oversized slices,
 *   2. infer + resolve `dependsOn`,
 *   3. topologically sort with canonical-priority tiebreak.
 */
export function planSlices(rawSlices: RawSlice[]): SlicePlan {
  const notes: string[] = [];
  if (!Array.isArray(rawSlices) || rawSlices.length === 0) {
    return { slices: [], notes: ['planSlices: empty input'] };
  }

  // Step 1 — split oversized slices.
  const split: PlannedSlice[] = [];
  for (const raw of rawSlices) {
    const subs = splitSlice(raw);
    if (subs.length > 1) {
      notes.push(
        `slice '${raw.id}' split into ${subs.length} sub-slice(s) (deliverables=${countDeliverables(raw)} > ${MAX_FEATURES_PER_SLICE})`,
      );
    }
    split.push(...subs);
  }

  // Step 2 — infer dependencies for slices that don't declare them.
  const idIndex = new Map<string, PlannedSlice[]>();
  for (const s of split) {
    const list = idIndex.get(s.parentId) ?? [];
    list.push(s);
    idIndex.set(s.parentId, list);
  }

  for (const s of split) {
    const declared = Array.isArray(s.dependsOn) ? s.dependsOn.filter((d) => typeof d === 'string') : [];
    const inferred = CANONICAL_DEPENDENCIES[s.parentId.toLowerCase()] ?? [];
    const merged = new Set<string>([...declared, ...inferred]);

    // For split slices, a sub-slice depends on the previous sub-slice of
    // the same parent so they build in batch order.
    if (s.splitTotal > 1 && s.splitIndex > 1) {
      const prev = split.find(
        (other) => other.parentId === s.parentId && other.splitIndex === s.splitIndex - 1,
      );
      if (prev) merged.add(prev.plannedId);
    }

    // Resolve each declared parent id to ALL its planned sub-slices.
    const resolved = new Set<string>();
    for (const dep of merged) {
      if (typeof dep !== 'string' || dep.length === 0) continue;
      // Direct planned-id match (e.g. when user passed an already-split id).
      if (split.some((o) => o.plannedId === dep)) {
        resolved.add(dep);
        continue;
      }
      const parents = idIndex.get(dep) ?? idIndex.get(dep.toLowerCase()) ?? [];
      for (const p of parents) resolved.add(p.plannedId);
    }
    // A slice never depends on itself.
    resolved.delete(s.plannedId);
    s.resolvedDeps = [...resolved];
  }

  // Step 3 — topological sort with canonical-priority tiebreak.
  const sorted = topoSort(split, notes);
  return { slices: sorted, notes };
}

// ── Slice-context helpers ─────────────────────────────────────

/**
 * Compact one-paragraph summary of a completed slice — fed into the
 * builder/polish prompt as "what's already built" so later slices can
 * reference stable names without dumping every prior file.
 *
 * Example:
 *   "Slice 'auth' (1/3) built — routes: /login, /register; tables: User,
 *    Session; components: LoginForm, RegisterForm; key apis: auth.login,
 *    auth.register, auth.session."
 */
export function summarizePlannedSlice(slice: PlannedSlice): string {
  const parts: string[] = [];
  const tag = slice.splitTotal > 1
    ? `'${slice.parentId}' (batch ${slice.splitIndex}/${slice.splitTotal})`
    : `'${slice.parentId}'`;
  parts.push(`Slice ${tag}`);
  if (slice.purpose) parts.push(`— ${slice.purpose}`);

  const fields: string[] = [];
  if (slice.routes?.length) fields.push(`routes: ${slice.routes.slice(0, 4).join(', ')}`);
  if (slice.dbTables?.length) fields.push(`tables: ${slice.dbTables.slice(0, 4).join(', ')}`);
  if (slice.components?.length) fields.push(`components: ${slice.components.slice(0, 4).join(', ')}`);
  if (slice.apiIds?.length) fields.push(`apis: ${slice.apiIds.slice(0, 4).join(', ')}`);
  if (fields.length > 0) parts.push(`(${fields.join('; ')})`);
  return parts.join(' ');
}

/**
 * Build a markdown context block summarising every PREVIOUSLY-completed
 * slice. Injected into the builder/polish prompt of slice K so the model
 * has stable cross-references without needing every file dumped.
 *
 * Returns "" when there are no completed slices yet.
 */
export function buildSliceManifest(completed: PlannedSlice[]): string {
  if (!completed || completed.length === 0) return '';
  const lines: string[] = [];
  lines.push('## 🧩 PREVIOUS SLICES (already built — DO NOT regenerate, EXTEND in place)');
  for (const s of completed) {
    lines.push(`- ${summarizePlannedSlice(s)}`);
  }
  lines.push('');
  lines.push('Reuse the routes, tables, and components above by their exact names. Do not redefine them.');
  return lines.join('\n');
}

// ── Internals ─────────────────────────────────────────────────

function countDeliverables(s: RawSlice): number {
  return (
    (s.routes?.length ?? 0) +
    (s.apiIds?.length ?? 0) +
    (s.components?.length ?? 0) +
    (s.dbTables?.length ?? 0)
  );
}

/**
 * Split an oversized slice into N sub-slices of <= MAX_FEATURES_PER_SLICE
 * deliverables each. The split is greedy + topical: each sub-slice grabs
 * one route + the apiIds/components/tables that share a token with that
 * route, falling back to round-robin for leftovers.
 */
function splitSlice(raw: RawSlice): PlannedSlice[] {
  const total = countDeliverables(raw);
  if (total <= MAX_FEATURES_PER_SLICE) {
    return [{
      ...raw,
      plannedId: raw.id,
      splitIndex: 1,
      splitTotal: 1,
      parentId: raw.id,
      resolvedDeps: [],
    }];
  }

  const routes = [...(raw.routes ?? [])];
  const apiIds = [...(raw.apiIds ?? [])];
  const components = [...(raw.components ?? [])];
  const dbTables = [...(raw.dbTables ?? [])];
  const acceptance = [...(raw.acceptance ?? [])];

  // How many batches do we need?
  const batches = Math.max(2, Math.ceil(total / MAX_FEATURES_PER_SLICE));
  const subs: PlannedSlice[] = [];

  for (let i = 0; i < batches; i++) {
    subs.push({
      ...raw,
      id: raw.id, // keep original id on the slice for traceability
      plannedId: `${raw.id}#${i + 1}`,
      splitIndex: i + 1,
      splitTotal: batches,
      parentId: raw.id,
      purpose: raw.purpose
        ? `${raw.purpose} (batch ${i + 1}/${batches})`
        : `${raw.id} batch ${i + 1}/${batches}`,
      routes: [],
      apiIds: [],
      components: [],
      dbTables: [],
      acceptance: [],
      resolvedDeps: [],
    });
  }

  // Greedy topical pass: assign routes one per batch, pulling related
  // apis/components/tables along.
  const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

  let cursor = 0;
  while (routes.length > 0) {
    const route = routes.shift()!;
    const target = subs[cursor % batches];
    cursor++;
    target.routes!.push(route);
    const tokens = new Set(tokenize(route));
    pullMatching(apiIds, tokens, target.apiIds!);
    pullMatching(components, tokens, target.components!);
    pullMatching(dbTables, tokens, target.dbTables!);
  }

  // Round-robin distribute whatever is left so nothing is dropped.
  const leftover = [
    ...apiIds.map((v) => ({ kind: 'apiIds' as const, v })),
    ...components.map((v) => ({ kind: 'components' as const, v })),
    ...dbTables.map((v) => ({ kind: 'dbTables' as const, v })),
  ];
  for (const item of leftover) {
    // Pick the smallest sub-slice so we balance load.
    const target = subs.reduce((a, b) => (countDeliverables(b) < countDeliverables(a) ? b : a));
    (target[item.kind] as string[]).push(item.v);
  }

  // Acceptance criteria: prefer to keep them all on the FIRST batch (so
  // user-visible progress is testable as soon as batch 1 lands), but
  // copy a 1-line "see batch 1" reference to subsequent batches.
  if (acceptance.length > 0) {
    subs[0].acceptance = acceptance;
    for (let i = 1; i < subs.length; i++) {
      subs[i].acceptance = [`See acceptance criteria on '${raw.id}' batch 1/${batches}`];
    }
  }

  return subs;
}

function pullMatching(pool: string[], tokens: Set<string>, into: string[]): void {
  for (let i = pool.length - 1; i >= 0; i--) {
    const candidate = pool[i].toLowerCase();
    let matches = false;
    for (const t of tokens) {
      if (candidate.includes(t)) { matches = true; break; }
    }
    if (matches) {
      into.push(pool[i]);
      pool.splice(i, 1);
    }
  }
}

/**
 * Topological sort with stable canonical-priority tiebreak.
 * Cycles are broken by dropping the offending edge and noting it.
 */
function topoSort(slices: PlannedSlice[], notes: string[]): PlannedSlice[] {
  const byId = new Map(slices.map((s) => [s.plannedId, s]));
  const inDegree = new Map<string, number>();
  const edges = new Map<string, Set<string>>(); // dep -> dependents

  for (const s of slices) {
    inDegree.set(s.plannedId, 0);
    edges.set(s.plannedId, new Set());
  }
  for (const s of slices) {
    for (const dep of s.resolvedDeps) {
      if (!byId.has(dep)) continue;
      inDegree.set(s.plannedId, (inDegree.get(s.plannedId) ?? 0) + 1);
      edges.get(dep)!.add(s.plannedId);
    }
  }

  const priorityOf = (s: PlannedSlice): number => {
    const idx = CANONICAL_SLICE_PRIORITY.indexOf(s.parentId.toLowerCase());
    return idx === -1 ? CANONICAL_SLICE_PRIORITY.length + 1 : idx;
  };

  const ready: PlannedSlice[] = slices.filter((s) => (inDegree.get(s.plannedId) ?? 0) === 0);
  const out: PlannedSlice[] = [];
  let guard = slices.length * 2;

  while (out.length < slices.length && guard-- > 0) {
    if (ready.length === 0) {
      // Cycle — break by picking the lowest-priority remaining slice.
      const remaining = slices.filter((s) => !out.includes(s));
      remaining.sort((a, b) => priorityOf(a) - priorityOf(b));
      const victim = remaining[0];
      notes.push(`slice cycle detected — breaking at '${victim.plannedId}'`);
      // Drop incoming edges to this slice.
      for (const set of edges.values()) set.delete(victim.plannedId);
      inDegree.set(victim.plannedId, 0);
      ready.push(victim);
    }
    // Pick the highest-priority ready slice (lowest canonical index, then
    // sub-batch order, then original spec order).
    ready.sort((a, b) => {
      const pa = priorityOf(a), pb = priorityOf(b);
      if (pa !== pb) return pa - pb;
      if (a.parentId !== b.parentId) {
        return slices.indexOf(a) - slices.indexOf(b);
      }
      return a.splitIndex - b.splitIndex;
    });
    const next = ready.shift()!;
    out.push(next);
    for (const dep of edges.get(next.plannedId) ?? []) {
      const left = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, left);
      if (left === 0) ready.push(byId.get(dep)!);
    }
  }
  if (out.length < slices.length) {
    notes.push(`topoSort: only emitted ${out.length}/${slices.length} slices — appending unsorted remainder`);
    for (const s of slices) if (!out.includes(s)) out.push(s);
  }
  return out;
}
