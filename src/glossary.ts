import { createSeedGlossary } from "./data";
import type {
  GlossaryBook,
  GlossaryConcept,
  GlossaryTranslation,
  LegacyProject,
  ReviewComment,
  SignItem,
  SignProject,
  SnapshotTerm,
  TermRef,
} from "./types";

const GLOSSARY_MASTER_KEY = "sologsb-1008-glossary-master-v2";
const GLOSSARY_CACHE_KEY = "sologsb-1008-glossary-cache-v2";
const GLOSSARY_FAULT_KEY = "sologsb-1008-glossary-fault";

export const conceptById = (book: GlossaryBook, termId: string) =>
  book.concepts.find((item) => item.id === termId);

export interface ResolvedTerm {
  ref: TermRef;
  concept: GlossaryConcept | undefined;
  tr: GlossaryTranslation | undefined;
  /** 当前项目语种下总表给出的生效译法；缺语种或已停用为 null。 */
  canonicalTarget: string | null;
  deactivated: boolean;
  missingLanguage: boolean;
}

/** 校对台解析一条引用：总表权威译法是什么，引用状态如何。 */
export function resolveTerm(ref: TermRef, language: string, book: GlossaryBook): ResolvedTerm {
  const concept = conceptById(book, ref.termId);
  const tr = concept?.translations[language];
  const missingLanguage = Boolean(concept) && !tr;
  const deactivated = Boolean(tr && !tr.active);
  return {
    ref,
    concept,
    tr,
    canonicalTarget: tr && tr.active ? tr.target : null,
    deactivated,
    missingLanguage,
  };
}

export function resolveSignTerms(sign: SignItem, book: GlossaryBook): ResolvedTerm[] {
  return sign.terms.map((ref) => resolveTerm(ref, sign.targetLanguage, book));
}

function pushNote(ref: TermRef, note: string) {
  if (ref.notes[0] !== note) ref.notes.unshift(note);
  ref.notes = ref.notes.slice(0, 8);
}

function systemComment(body: string): ReviewComment {
  return {
    id: `sys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    author: "术语同步",
    body,
    createdAt: new Date().toISOString(),
    resolved: false,
    replies: [],
  };
}

export interface SyncCounts {
  reconfirmed: number;
  deactivated: number;
  conflicts: number;
}

/**
 * 总表应用到一条标识的引用上：
 * - 管理员改了译法或停用：标识译文不改写，只把引用标为待重新确认，备注留校对台；
 * - 两边都动过（localEdited）：以总表为准，同样只打标，并在意见里留冲突记录；
 * - 无实质改动（只动了修订号）：静默跟上，不打扰校对员。
 */
export function syncSign(sign: SignItem, book: GlossaryBook, stamp: string): SyncCounts {
  const counts: SyncCounts = { reconfirmed: 0, deactivated: 0, conflicts: 0 };
  for (const ref of sign.terms) {
    const resolved = resolveTerm(ref, sign.targetLanguage, book);
    const source = resolved.concept?.source ?? ref.termId;

    if (!resolved.concept) {
      pushNote(ref, `${stamp} 总表条目已不存在，等待管理员核对。`);
      if (!ref.pendingReconfirm) {
        ref.pendingReconfirm = true;
        counts.reconfirmed += 1;
      }
      continue;
    }
    if (!resolved.tr) {
      if (!ref.pendingReconfirm) {
        ref.pendingReconfirm = true;
        pushNote(ref, `${stamp} 总表尚未提供「${sign.targetLanguage}」译法，待补。`);
        counts.reconfirmed += 1;
      }
      continue;
    }

    const targetChanged = resolved.tr.target !== ref.seenTarget;
    const activeChanged = resolved.tr.active !== ref.seenActive;
    const revisionChanged = resolved.tr.revision !== ref.seenRevision;
    if (!targetChanged && !activeChanged) {
      if (revisionChanged) ref.seenRevision = resolved.tr.revision;
      continue;
    }

    if (!ref.pendingReconfirm) {
      ref.pendingReconfirm = true;
      if (targetChanged) {
        counts.reconfirmed += 1;
        if (ref.localEdited) {
          counts.conflicts += 1;
          pushNote(
            ref,
            `${stamp} 两边都动过「${source}」译法，以总表为准：本项目「${ref.seenTarget}」→ 总表「${resolved.tr.target}」，待重新确认。`,
          );
          sign.comments.unshift(
            systemComment(
              `「${source}」本项目译法「${ref.seenTarget}」与管理员新定译法「${resolved.tr.target}」冲突，按规则以总表为准；标识译文未改写，请重新确认。`,
            ),
          );
        } else {
          pushNote(ref, `${stamp} 管理员更新「${source}」译法为「${resolved.tr.target}」，待重新确认。`);
        }
      } else if (!resolved.tr.active) {
        counts.deactivated += 1;
        pushNote(ref, `${stamp} 管理员停用了「${source}」（${sign.targetLanguage}），待重新确认。`);
      } else {
        pushNote(ref, `${stamp} 管理员重新启用「${source}」（${sign.targetLanguage}），待重新确认。`);
      }
    }
    // 只打标，不改写译文；seen* 保留，等校对员确认时再跟上。
  }

  const needsReconfirm = sign.terms.some((ref) => ref.pendingReconfirm);
  if (needsReconfirm && sign.status === "confirmed") sign.status = "pending";
  return counts;
}

export function syncProject(project: SignProject, book: GlossaryBook, stamp = new Date().toISOString()): SyncCounts {
  const total: SyncCounts = { reconfirmed: 0, deactivated: 0, conflicts: 0 };
  for (const sign of project.signs) {
    const counts = syncSign(sign, book, stamp);
    total.reconfirmed += counts.reconfirmed;
    total.deactivated += counts.deactivated;
    total.conflicts += counts.conflicts;
  }
  return total;
}

/** 校对员完成本项目确认：状态跟上当前总表；确认动作不改译文。 */
export function confirmRef(sign: SignItem, refId: string, book: GlossaryBook) {
  const ref = sign.terms.find((item) => item.id === refId);
  if (!ref) return;
  const resolved = resolveTerm(ref, sign.targetLanguage, book);
  if (!resolved.tr || resolved.missingLanguage) return; // 缺语种无法确认
  ref.confirmed = true;
  ref.pendingReconfirm = false;
  ref.localEdited = false;
  ref.seenTarget = resolved.tr.target;
  ref.seenActive = resolved.tr.active;
  ref.seenRevision = resolved.tr.revision;
  pushNote(ref, `${new Date().toISOString()} 本项目已按总表（revision ${resolved.tr.revision}）确认。`);
}

export function snapshotTerms(sign: SignItem, book: GlossaryBook): SnapshotTerm[] {
  return sign.terms.map((ref) => {
    const resolved = resolveTerm(ref, sign.targetLanguage, book);
    return {
      termId: ref.termId,
      source: resolved.concept?.source ?? ref.termId,
      target: resolved.tr?.target ?? ref.seenTarget,
      required: ref.required,
      active: Boolean(resolved.tr?.active),
    };
  });
}

/* ---------------- 旧数据迁移：合成总表 + 转引用 ---------------- */

export interface MigrationResult {
  project: SignProject;
  book: GlossaryBook;
  mergedBindings: number;
  dedupedBindings: number;
  createdConcepts: number;
  reconfirmOnConflict: number;
}

/**
 * 旧数据第一次打开要迁移进这套引用，重复的合成一条。
 * 同一（中文源语, 语种）下出现多个译法：按出现次数取胜者合成进总表；
 * 使用了落败译法的引用标待重新确认（校对台侧动过，等管理员定夺）。
 */
export function migrateLegacyProject(legacy: LegacyProject, existingBook?: GlossaryBook): MigrationResult {
  const stamp = new Date().toISOString();
  const book = existingBook ? structuredClone(existingBook) : createSeedGlossary();
  book.concepts = book.concepts.filter((concept) => concept.translations && Object.keys(concept.translations).length);

  type Cell = { source: string; language: string; winners: Map<string, number>; occurrences: number; signRefs: Set<string> };
  const cellKey = (source: string, language: string) => `${source}${language}`;
  const cells = new Map<string, Cell>();
  for (const sign of legacy.signs) {
    for (const binding of sign.terms) {
      const key = cellKey(binding.source.trim(), sign.targetLanguage);
      let cell = cells.get(key);
      if (!cell) {
        cell = { source: binding.source.trim(), language: sign.targetLanguage, winners: new Map(), occurrences: 0, signRefs: new Set() };
        cells.set(key, cell);
      }
      cell.winners.set(binding.target, (cell.winners.get(binding.target) ?? 0) + 1);
      cell.occurrences += 1;
      cell.signRefs.add(sign.id);
    }
  }

  let createdConcepts = 0;
  let conceptSeq = book.concepts.reduce((max, item) => {
    const n = Number(item.id.replace(/^gloss-/, ""));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const resolveCell = new Map<string, { conceptId: string; winner: string }>();
  for (const [key, cell] of cells) {
    let concept = book.concepts.find((item) => item.source === cell.source);
    if (!concept) {
      conceptSeq += 1;
      concept = {
        id: `gloss-${String(conceptSeq).padStart(3, "0")}`,
        source: cell.source,
        translations: {},
      };
      book.concepts.push(concept);
      createdConcepts += 1;
    }
    let winner = concept.translations[cell.language]?.target ?? "";
    const votes = [...cell.winners.entries()].sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1,
    );
    if (!winner) {
      winner = votes[0]?.[0] ?? "";
      concept.translations[cell.language] = {
        target: winner,
        active: true,
        note: "旧数据迁移合成",
        revision: 1,
        updatedAt: stamp,
        updatedBy: "数据迁移",
      };
    }
    resolveCell.set(key, { conceptId: concept.id, winner });
  }

  let mergedBindings = 0;
  // 跨牌子重复：同一（源语+语种）被多条牌子各自绑过，合成为一条总表条目。
  let dedupedBindings = 0;
  for (const cell of cells.values()) {
    dedupedBindings += Math.max(0, cell.signRefs.size - 1);
  }
  let reconfirmOnConflict = 0;
  const signs: SignItem[] = legacy.signs.map((oldSign) => {
    const used = new Set<string>();
    const terms: TermRef[] = [];
    for (const binding of oldSign.terms) {
      const key = cellKey(binding.source.trim(), oldSign.targetLanguage);
      if (used.has(key)) {
        mergedBindings += 1; // 同一条牌子内的重复绑定直接丢弃
        continue;
      }
      used.add(key);
      const cell = resolveCell.get(key)!;
      const concept = book.concepts.find((item) => item.id === cell.conceptId)!;
      const tr = concept.translations[oldSign.targetLanguage]!;
      const conflict = binding.target !== cell.winner;
      if (conflict) reconfirmOnConflict += 1;
      terms.push({
        id: `ref-${Math.random().toString(36).slice(2, 9)}`,
        termId: cell.conceptId,
        required: binding.required,
        confirmed: binding.confirmed && !conflict,
        pendingReconfirm: conflict,
        localEdited: conflict,
        seenTarget: tr.target,
        seenActive: true,
        seenRevision: tr.revision,
        notes: conflict
          ? [
              `${stamp} 迁移：旧数据中「${binding.source}」存在不一致译法，已合成总表译法「${cell.winner}」；本牌子原为「${binding.target}」，以总表为准，待重新确认。`,
            ]
          : [`${stamp} 迁移：由旧术语绑定转为总表引用。`],
      });
    }
    const cellRefKey = (source: string) => cellKey(source.trim(), oldSign.targetLanguage);
    return {
      id: oldSign.id,
      code: oldSign.code,
      sourceText: oldSign.sourceText,
      targetLanguage: oldSign.targetLanguage,
      targetText: oldSign.targetText,
      scenario: oldSign.scenario,
      regulation: oldSign.regulation,
      status: oldSign.status,
      terms,
      comments: oldSign.comments ?? [],
      versions: (oldSign.versions ?? []).map((version) => ({
        ...version,
        terms: version.terms.map((binding) => {
          const mapped = resolveCell.get(cellRefKey(binding.source));
          const concept = mapped && book.concepts.find((item) => item.id === mapped.conceptId);
          const tr = concept?.translations[oldSign.targetLanguage];
          return {
            termId: mapped?.conceptId ?? `legacy:${binding.source}`,
            source: binding.source,
            target: tr?.target ?? binding.target,
            required: binding.required,
            active: Boolean(tr?.active),
          } satisfies SnapshotTerm;
        }),
      })),
      emergencyRevision: oldSign.emergencyRevision,
      updatedAt: oldSign.updatedAt,
    };
  });

  if (createdConcepts || reconfirmOnConflict) {
    book.revision += 1;
    book.updatedAt = stamp;
  }

  const project: SignProject = {
    id: legacy.id,
    title: legacy.title,
    location: legacy.location,
    activeSignId: legacy.activeSignId,
    signs,
    updatedAt: new Date().toISOString(),
    migration: {
      migratedAt: stamp,
      mergedBindings,
      dedupedBindings,
      createdConcepts,
      reconfirmOnConflict,
    },
  };

  return { project, book, mergedBindings, dedupedBindings, createdConcepts, reconfirmOnConflict };
}

/* ---------------- 总表读取：侧重试，失败照上一版继续 ---------------- */

export type GlossarySource = "master" | "cache" | "bundled";

export interface GlossaryLoadResult {
  book: GlossaryBook;
  source: GlossarySource;
  /** 重试后仍失败、正在照上一版（或内置兜底）校对。 */
  degraded: boolean;
  attempts: number;
  /** 本地不存在总表（全新环境，需要迁移初始化）。 */
  absent?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function readBook(key: string): GlossaryBook | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GlossaryBook;
    if (!parsed || !Array.isArray(parsed.concepts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 模拟“总表读不出来”：管理员面板可拨动开关制造读取失败。 */
export function setGlossaryFault(fault: boolean) {
  try {
    if (fault) localStorage.setItem(GLOSSARY_FAULT_KEY, "1");
    else localStorage.removeItem(GLOSSARY_FAULT_KEY);
  } catch {
    // 存储不可用时忽略。
  }
}

export function isGlossaryFault() {
  try {
    return localStorage.getItem(GLOSSARY_FAULT_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 读取机构术语总表。
 * 失败后按侧重试（共 3 次尝试：即时 / 200ms / 500ms，侧重首次快速反馈）；
 * 全部失败则照上一版成功读取（localStorage 缓存）继续校对，再退一步用内置总表兜底。
 */
export async function loadGlossary(): Promise<GlossaryLoadResult> {
  const master = readBook(GLOSSARY_MASTER_KEY);
  if (master === null && !isGlossaryFault()) {
    return { book: createSeedGlossary(), source: "bundled", degraded: false, attempts: 1, absent: true };
  }

  const delays = [0, 200, 500];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt]);
    if (!isGlossaryFault()) {
      const fresh = readBook(GLOSSARY_MASTER_KEY);
      if (fresh) return { book: fresh, source: "master", degraded: false, attempts: attempt + 1 };
      return { book: createSeedGlossary(), source: "bundled", degraded: false, attempts: attempt + 1, absent: true };
    }
  }

  const cached = readBook(GLOSSARY_CACHE_KEY);
  if (cached) return { book: cached, source: "cache", degraded: true, attempts: delays.length };
  return { book: createSeedGlossary(), source: "bundled", degraded: true, attempts: delays.length };
}

/** 管理员发布总表：写权威副本，并立刻刷新“上一版”缓存。 */
export function publishGlossary(book: GlossaryBook): void {
  const stamp = new Date().toISOString();
  book.updatedAt = stamp;
  const raw = JSON.stringify(book);
  try {
    localStorage.setItem(GLOSSARY_MASTER_KEY, raw);
    localStorage.setItem(GLOSSARY_CACHE_KEY, raw);
  } catch {
    // 存储不可用时发布无法持久化，调用方负责提示。
  }
}

export function cacheGlossary(book: GlossaryBook): void {
  try {
    if (!localStorage.getItem(GLOSSARY_CACHE_KEY)) {
      localStorage.setItem(GLOSSARY_CACHE_KEY, JSON.stringify(book));
    }
  } catch {
    // 忽略缓存写入失败。
  }
}
