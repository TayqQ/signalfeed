// Greedy centroid clustering of tag embeddings into themes (spec-phase2
// section 7.1, D34). Pure: no I/O, no clock, no randomness.

/**
 * τ: the least cosine similarity for a tag to join a theme when there is no
 * LLM check, and the fallback for band tags when the check is refused or
 * fails (D47). Set by the theme eval (Task 039, D46) for tags embedded with the
 * "Startup market: <tag>" template. The template raises every similarity, so
 * τ is high.
 */
export const DEFAULT_THEME_THRESHOLD = 0.76;

export type Vector = readonly number[];

function dot(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new Error(`Vector lengths differ: ${a.length} and ${b.length}`);
  }
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i]! * b[i]!;
  return total;
}

function length(v: Vector): number {
  return Math.sqrt(dot(v, v));
}

/** Cosine similarity in [-1, 1]. Zero when either vector has no length. */
export function cosine(a: Vector, b: Vector): number {
  const lengths = length(a) * length(b);
  return lengths === 0 ? 0 : dot(a, b) / lengths;
}

/** The unit vector in the same direction. A zero vector is returned unchanged. */
export function normalise(v: Vector): number[] {
  const size = length(v);
  return size === 0 ? [...v] : v.map((x) => x / size);
}

function addInto(target: number[], v: Vector): void {
  if (target.length !== v.length) {
    throw new Error(`Vector lengths differ: ${target.length} and ${v.length}`);
  }
  for (let i = 0; i < v.length; i++) target[i]! += v[i]!;
}

function sumOf(vectors: readonly Vector[]): number[] {
  const [first, ...rest] = vectors;
  if (!first) throw new Error("Need at least one vector");
  const sum = [...first];
  for (const v of rest) addInto(sum, v);
  return sum;
}

/** The normalised mean of the vectors. Needs at least one vector. */
export function meanCentroid(vectors: readonly Vector[]): number[] {
  return normalise(sumOf(vectors));
}

export interface GreedyTag {
  id: number;
  slug: string;
  /** What the LLM check shows for the tag. Defaults to the slug. */
  label?: string;
  /** Total mentions across companies. Higher goes first. */
  mentions: number;
  embedding: Vector;
}

/** A tag already in a theme, as the LLM check shows it. */
export interface MemberTag {
  label: string;
  mentions: number;
}

export interface GreedyTheme {
  id: number;
  centroid: Vector;
  /**
   * Embeddings of the tags already in the theme. A new member updates the
   * centroid to the normalised mean of these plus the newcomers. When empty,
   * the stored centroid stands in for the existing members.
   */
  members: readonly Vector[];
  /** Member tags for the LLM check. Absent or empty: the name stands in. */
  memberTags?: readonly MemberTag[];
  name?: string;
}

/** An existing theme by id, or a theme this run creates, by its position in `newThemes`. */
export type ThemeTarget =
  { kind: "existing"; id: number } | { kind: "new"; index: number };

/**
 * How a tag was placed: `embedding` by similarity alone (outside the band, or
 * with no LLM check); `llm_join` and `llm_new` by a verdict; `fallback` in the
 * band with no verdict, by the embedding-only threshold.
 */
export type AssignmentDecision =
  "embedding" | "llm_join" | "llm_new" | "fallback";

export interface GreedyAssignment {
  tagId: number;
  target: ThemeTarget;
  /** Cosine similarity to the centroid at the moment of assignment. 1 for a seed tag. */
  similarity: number;
  decision: AssignmentDecision;
}

export interface GreedyNewTheme {
  seedTagId: number;
  seedSlug: string;
  centroid: number[];
}

export interface GreedyCentroidUpdate {
  id: number;
  centroid: number[];
}

export interface GreedyResult {
  /** One per input tag, in processing order. */
  assignments: GreedyAssignment[];
  /** In creation order, so database ids follow this order. */
  newThemes: GreedyNewTheme[];
  /** Existing themes that gained a member, with their final centroid, by id. */
  updatedCentroids: GreedyCentroidUpdate[];
  /** Band questions with no verdict, in processing order. Each fell back. */
  unanswered: BandQuestion[];
}

/**
 * The two-band rule (D47). A tag whose best similarity is at least `high`
 * joins that theme. Below `low` it starts a new theme. In between, an LLM
 * verdict decides.
 */
export interface ThemeBands {
  low: number;
  high: number;
}

/**
 * Bands chosen by the theme eval (D47) on recorded `gpt-5.6-luna` verdicts.
 * Tags whose best similarity is in [low, high) go to the LLM check.
 */
export const DEFAULT_THEME_BANDS: ThemeBands = { low: 0.72, high: 0.88 };
/** Candidate themes shown for one tag, best first. */
export const THEME_CHECK_MAX_CANDIDATES = 3;
/** Member tags shown for one candidate theme, most mentioned first. */
export const THEME_CHECK_TOP_TAGS = 6;

export interface BandCandidate {
  target: ThemeTarget;
  /** Stable within a run: `theme:<id>` or `seed:<tag id>` for a new theme. */
  ref: string;
  similarity: number;
  /** Top member labels, most mentioned first. */
  tags: string[];
}

/** A tag in the band and the themes it might join. */
export interface BandQuestion {
  tagId: number;
  /** The tag's label. */
  tag: string;
  /** At most `THEME_CHECK_MAX_CANDIDATES`, best first, each at least `low`. */
  candidates: BandCandidate[];
  /** Identifies the question by what the LLM sees (`bandQuestionKey`). */
  key: string;
  /**
   * Identifies the question by the tag and the set of candidate themes. Stays
   * the same when a candidate gains members, so a verdict is reused.
   */
  refKey: string;
}

/** An index into `candidates`, or null when the tag fits none of them. */
export type BandVerdict = number | null;

export interface BandCheck {
  bands: ThemeBands;
  /** The verdict for a question, or undefined when there is none yet. */
  verdictFor(question: BandQuestion): BandVerdict | undefined;
}

/** The text the LLM sees, so equal keys mean equal questions. */
export function bandQuestionKey(
  tag: string,
  candidates: readonly { tags: readonly string[] }[],
): string {
  return JSON.stringify([tag, candidates.map((candidate) => candidate.tags)]);
}

export interface AssignGreedyInput {
  tags: readonly GreedyTag[];
  themes: readonly GreedyTheme[];
  /** Embedding-only τ: the rule with no check, and the fallback in the band. */
  threshold?: number;
  /** The two-band LLM check. Absent: embedding only. */
  check?: BandCheck;
}

interface WorkingTheme {
  target: ThemeTarget;
  /** Existing themes sort by id; new themes come after all of them, in creation order. */
  rank: [number, number];
  centroid: number[];
  sum: number[];
  changed: boolean;
  memberTags: MemberTag[];
  name: string;
  ref: string;
}

function compareCodePoints(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Mentions descending, then slug, then id: the spec's fixed order. */
export function compareTagsForAssignment(a: GreedyTag, b: GreedyTag): number {
  return (
    b.mentions - a.mentions || compareCodePoints(a.slug, b.slug) || a.id - b.id
  );
}

function ranksBefore(a: WorkingTheme, b: WorkingTheme): boolean {
  return (
    a.rank[0] < b.rank[0] || (a.rank[0] === b.rank[0] && a.rank[1] < b.rank[1])
  );
}

function topTags(theme: WorkingTheme): string[] {
  if (theme.memberTags.length === 0) return theme.name ? [theme.name] : [];
  return [...theme.memberTags]
    .sort(
      (a, b) => b.mentions - a.mentions || compareCodePoints(a.label, b.label),
    )
    .slice(0, THEME_CHECK_TOP_TAGS)
    .map((member) => member.label);
}

interface Scored {
  theme: WorkingTheme;
  similarity: number;
}

/** Similarity to every theme, best first. Ties go to the lower rank. */
function rankThemes(tag: GreedyTag, working: WorkingTheme[]): Scored[] {
  return working
    .map((theme) => ({
      theme,
      similarity: cosine(tag.embedding, theme.centroid),
    }))
    .sort((a, b) =>
      b.similarity !== a.similarity
        ? b.similarity - a.similarity
        : ranksBefore(a.theme, b.theme)
          ? -1
          : ranksBefore(b.theme, a.theme)
            ? 1
            : 0,
    );
}

function bandQuestion(
  tag: GreedyTag,
  ranked: readonly Scored[],
  low: number,
): BandQuestion {
  const candidates = ranked
    .filter((scored) => scored.similarity >= low)
    .slice(0, THEME_CHECK_MAX_CANDIDATES)
    .map((scored) => ({
      target: scored.theme.target,
      ref: scored.theme.ref,
      similarity: scored.similarity,
      tags: topTags(scored.theme),
    }));
  const label = tag.label ?? tag.slug;
  const refs = candidates.map((candidate) => candidate.ref).sort();
  return {
    tagId: tag.id,
    tag: label,
    candidates,
    key: bandQuestionKey(label, candidates),
    refKey: JSON.stringify([tag.id, refs]),
  };
}

/**
 * Assigns each tag to the most similar theme centroid when the similarity is
 * at least `threshold`, otherwise starts a new theme seeded by the tag.
 * Centroids are updated after every assignment. Ties go to the lower theme id
 * (existing themes before new ones). Input order does not matter: tags are
 * sorted by mentions descending, then slug.
 *
 * With `check`, a tag whose best similarity lies in the band takes the
 * verdict instead: the chosen candidate, or a new theme. A band tag with no
 * verdict falls back to `threshold` and is listed in `unanswered`.
 */
export function assignGreedy({
  tags,
  themes,
  threshold = DEFAULT_THEME_THRESHOLD,
  check,
}: AssignGreedyInput): GreedyResult {
  const working: WorkingTheme[] = [...themes]
    .sort((a, b) => a.id - b.id)
    .map((theme) => ({
      target: { kind: "existing", id: theme.id },
      rank: [0, theme.id],
      centroid: normalise(theme.centroid),
      sum:
        theme.members.length > 0
          ? sumOf(theme.members)
          : normalise(theme.centroid),
      changed: false,
      memberTags: [...(theme.memberTags ?? [])],
      name: theme.name ?? "",
      ref: `theme:${theme.id}`,
    }));

  const ordered = [...tags].sort(compareTagsForAssignment);
  const assignments: GreedyAssignment[] = [];
  const newThemes: GreedyNewTheme[] = [];
  const unanswered: BandQuestion[] = [];

  const join = (
    tag: GreedyTag,
    theme: WorkingTheme,
    similarity: number,
    decision: AssignmentDecision,
  ) => {
    addInto(theme.sum, tag.embedding);
    theme.centroid = normalise(theme.sum);
    theme.changed = true;
    theme.memberTags.push({
      label: tag.label ?? tag.slug,
      mentions: tag.mentions,
    });
    assignments.push({
      tagId: tag.id,
      target: theme.target,
      similarity,
      decision,
    });
  };

  const startTheme = (tag: GreedyTag, decision: AssignmentDecision) => {
    const index = newThemes.length;
    const centroid = normalise(tag.embedding);
    newThemes.push({ seedTagId: tag.id, seedSlug: tag.slug, centroid });
    working.push({
      target: { kind: "new", index },
      rank: [1, index],
      centroid,
      sum: [...tag.embedding],
      changed: true,
      memberTags: [{ label: tag.label ?? tag.slug, mentions: tag.mentions }],
      name: tag.label ?? tag.slug,
      ref: `seed:${tag.id}`,
    });
    assignments.push({
      tagId: tag.id,
      target: { kind: "new", index },
      similarity: 1,
      decision,
    });
  };

  for (const tag of ordered) {
    const ranked = rankThemes(tag, working);
    const best = ranked[0];

    if (!check) {
      if (best && best.similarity >= threshold) {
        join(tag, best.theme, best.similarity, "embedding");
      } else {
        startTheme(tag, "embedding");
      }
      continue;
    }

    const { low, high } = check.bands;
    if (best && best.similarity >= high) {
      join(tag, best.theme, best.similarity, "embedding");
      continue;
    }
    if (!best || best.similarity < low) {
      startTheme(tag, "embedding");
      continue;
    }

    const question = bandQuestion(tag, ranked, low);
    const verdict = check.verdictFor(question);
    if (verdict === undefined) {
      unanswered.push(question);
      if (best.similarity >= threshold) {
        join(tag, best.theme, best.similarity, "fallback");
      } else {
        startTheme(tag, "fallback");
      }
      continue;
    }
    const chosen = verdict === null ? undefined : ranked[verdict];
    if (chosen && verdict !== null && verdict < question.candidates.length) {
      join(tag, chosen.theme, chosen.similarity, "llm_join");
    } else {
      startTheme(tag, "llm_new");
    }
  }

  const updatedCentroids: GreedyCentroidUpdate[] = [];
  for (const theme of working) {
    if (theme.target.kind === "new") {
      newThemes[theme.target.index]!.centroid = theme.centroid;
    } else if (theme.changed) {
      updatedCentroids.push({ id: theme.target.id, centroid: theme.centroid });
    }
  }

  return { assignments, newThemes, updatedCentroids, unanswered };
}
