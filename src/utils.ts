import type { DiffToken, MasterLoadResult, PersistedMaster, SignProject, SyncReport, TermBinding, TermEntry, TermMaster } from "./types";
import { uid } from "./data";

const MASTER_STORAGE_KEY = "sologsb-1008-term-master-v1";

export function estimatedLines(text: string, width: number, fontSize: number, lineHeight = 1.25) {
  if (!text.trim()) return [];
  const usable = Math.max(120, width - 48);
  const lines: string[] = [];
  for (const hardLine of text.split("\n")) {
    if (!hardLine) {
      lines.push("");
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const char of hardLine) {
      const charWidth = /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)
        ? fontSize
        : char === " "
          ? fontSize * 0.34
          : fontSize * 0.58;
      if (current && currentWidth + charWidth > usable) {
        lines.push(current.trimEnd());
        current = char.trimStart();
        currentWidth = charWidth;
      } else {
        current += char;
        currentWidth += charWidth;
      }
    }
    if (current) lines.push(current.trimEnd());
  }
  return lines;
}

export function analyzeSign(sign: SignProject["signs"][number], width: number, fontSize: number) {
  const lines = estimatedLines(sign.targetText, width, fontSize);
  const lineCapacity = Math.max(1, Math.floor((width * 0.62) / (fontSize * 1.25)));
  const visible = lines.slice(0, lineCapacity);
  const overflow = lines.length > lineCapacity;
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const estimatedCharacterLimit = Math.max(12, Math.floor((width - 48) / (fontSize * 0.55)) * lineCapacity);
  const tooLong = sign.targetText.replace(/\s/g, "").length > estimatedCharacterLimit;
  const missingTerms = sign.terms.filter(
    (term) => term.required && !sign.targetText.toLocaleLowerCase().includes(term.target.toLocaleLowerCase()),
  );
  const staleTerms = sign.terms.filter((term) => term.stale);
  return {
    lines,
    visible,
    overflow,
    tooLong,
    missingTerms,
    staleTerms,
    risk: overflow || tooLong || missingTerms.length ? "high" : lines.length >= lineCapacity - 1 ? "medium" : "low",
  };
}

function tokenize(value: string) {
  return value.match(/[\u3400-\u9fff]|[A-Za-zÀ-ÿ0-9'’\-]+|\s+|./gu) ?? [];
}

function lcsTable(left: string[], right: string[]) {
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

export function diffText(oldText: string, newText: string): DiffToken[] {
  const left = tokenize(oldText);
  const right = tokenize(newText);
  if (left.length * right.length > 180000) {
    return [{ type: "remove", value: oldText }, { type: "add", value: newText }];
  }
  const table = lcsTable(left, right);
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffToken["type"], value: string) => {
    const previous = tokens.at(-1);
    if (previous?.type === type) previous.value += value;
    else tokens.push({ type, value });
  };
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("remove", left[i]);
      i += 1;
    } else {
      push("add", right[j]);
      j += 1;
    }
  }
  while (i < left.length) push("remove", left[i++]);
  while (j < right.length) push("add", right[j++]);
  return tokens;
}

export function cloneTerms(terms: TermBinding[]) {
  return structuredClone(terms);
}

// ─── 术语总表读写 ───────────────────────────────────────────────

export function loadMaster(): MasterLoadResult {
  try {
    const raw = localStorage.getItem(MASTER_STORAGE_KEY);
    if (!raw) return { master: null, ok: false, error: "术语总表不存在" };
    const parsed = JSON.parse(raw) as PersistedMaster;
    if (parsed.schema !== 1 || !parsed.master?.entries) {
      return { master: null, ok: false, error: "术语总表格式不正确" };
    }
    return { master: parsed.master, ok: true };
  } catch (err) {
    return { master: null, ok: false, error: err instanceof Error ? err.message : "术语总表读取失败" };
  }
}

export function saveMaster(master: TermMaster): void {
  try {
    localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify({ schema: 1, master }));
  } catch {
    // 存储不可用时静默失败
  }
}

// ─── 术语绑定与总表同步 ─────────────────────────────────────────

/** 核对单条绑定与总表条目，返回带 stale 标记的新绑定 */
export function syncBinding(binding: TermBinding, entry: TermEntry | undefined): TermBinding {
  if (!entry) {
    return { ...binding, stale: true, staleReason: "missing" };
  }
  if (entry.status === "inactive") {
    return { ...binding, stale: true, staleReason: "deactivated" };
  }
  if (entry.updatedAt !== binding.entryUpdatedAt) {
    return { ...binding, stale: true, staleReason: "changed" };
  }
  return { ...binding, stale: false, staleReason: undefined };
}

/** 以总表为准重新确认：译文取总表，备注留在校对台 */
export function reconcileBinding(binding: TermBinding, entry: TermEntry): TermBinding {
  return {
    ...binding,
    source: entry.source,
    target: entry.target,
    entryUpdatedAt: entry.updatedAt,
    stale: false,
    staleReason: undefined,
    confirmed: true,
    // note 保留在校对台
  };
}

/** 同步整个项目的术语绑定；总表读不出来时原样返回（快照继续校对） */
export function syncProject(project: SignProject, master: TermMaster | null): { project: SignProject; report: SyncReport } {
  const newProject = structuredClone(project);
  const report: SyncReport = { changed: 0, deactivated: 0, missing: 0, reactivated: 0 };
  if (!master) return { project: newProject, report };

  for (const sign of newProject.signs) {
    for (let i = 0; i < sign.terms.length; i += 1) {
      const term = sign.terms[i];
      if (!term.entryId) continue;
      const entry = master.entries.find((item) => item.id === term.entryId);
      const before = term.stale;
      const synced = syncBinding(term, entry);
      if (synced.stale && !before) {
        if (synced.staleReason === "changed") report.changed += 1;
        else if (synced.staleReason === "deactivated") report.deactivated += 1;
        else if (synced.staleReason === "missing") report.missing += 1;
      }
      if (!synced.stale && before) report.reactivated += 1;
      sign.terms[i] = synced;
    }
  }
  return { project: newProject, report };
}

/** 按侧重试：优先同步当前标识，再同步其余 */
export function retrySync(project: SignProject, master: TermMaster | null, activeSignId: string): { project: SignProject; report: SyncReport } {
  const newProject = structuredClone(project);
  const report: SyncReport = { changed: 0, deactivated: 0, missing: 0, reactivated: 0 };
  if (!master) return { project: newProject, report };

  const signs = [...newProject.signs].sort((a, b) =>
    a.id === activeSignId ? -1 : b.id === activeSignId ? 1 : 0,
  );
  for (const sign of signs) {
    for (let i = 0; i < sign.terms.length; i += 1) {
      const term = sign.terms[i];
      if (!term.entryId) continue;
      const entry = master.entries.find((item) => item.id === term.entryId);
      const before = term.stale;
      const synced = syncBinding(term, entry);
      if (synced.stale && !before) {
        if (synced.staleReason === "changed") report.changed += 1;
        else if (synced.staleReason === "deactivated") report.deactivated += 1;
        else if (synced.staleReason === "missing") report.missing += 1;
      }
      if (!synced.stale && before) report.reactivated += 1;
      sign.terms[i] = synced;
    }
  }
  return { project: newProject, report };
}

// ─── 旧数据迁移 ─────────────────────────────────────────────────

/** 把旧版内联术语迁移为总表引用，重复的合成一条 */
export function migrateProject(project: SignProject, master: TermMaster): { project: SignProject; master: TermMaster; migratedCount: number } {
  const newMaster = structuredClone(master);
  let migratedCount = 0;
  const newProject = structuredClone(project);

  for (const sign of newProject.signs) {
    const seen = new Set<string>();
    const newTerms: TermBinding[] = [];

    for (const term of sign.terms) {
      // 已是引用：按 entryId 去重，并把快照刷新为总表当前值
      if (term.entryId) {
        if (seen.has(term.entryId)) continue;
        seen.add(term.entryId);
        const entry = newMaster.entries.find((item) => item.id === term.entryId);
        if (entry) {
          term.source = entry.source;
          term.target = entry.target;
          term.entryUpdatedAt = entry.updatedAt;
          term.stale = false;
          term.staleReason = undefined;
        }
        newTerms.push(term);
        continue;
      }

      // 旧版内联术语：查找或新建总表条目
      let entry = newMaster.entries.find(
        (item) => item.source === term.source && item.language === sign.targetLanguage,
      );
      if (!entry) {
        entry = {
          id: uid("term"),
          source: term.source,
          language: sign.targetLanguage,
          target: term.target,
          status: "active",
          note: "",
          updatedAt: new Date().toISOString(),
        };
        newMaster.entries.push(entry);
      }

      if (seen.has(entry.id)) continue;
      seen.add(entry.id);

      newTerms.push({
        id: term.id || uid("bind"),
        entryId: entry.id,
        source: entry.source,
        target: entry.target,
        entryUpdatedAt: entry.updatedAt,
        required: term.required ?? true,
        confirmed: term.confirmed ?? false,
        note: "",
        stale: false,
      });
      migratedCount += 1;
    }

    sign.terms = newTerms;
  }

  return { project: newProject, master: newMaster, migratedCount };
}

// ─── 总表条目管理 ───────────────────────────────────────────────

export function createTermEntry(source: string, language: string, target: string, note = ""): TermEntry {
  return {
    id: uid("term"),
    source,
    language,
    target,
    status: "active",
    note,
    updatedAt: new Date().toISOString(),
  };
}

export function upsertEntry(master: TermMaster, entry: TermEntry): TermMaster {
  const newMaster = structuredClone(master);
  const index = newMaster.entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) newMaster.entries[index] = { ...entry, updatedAt: new Date().toISOString() };
  else newMaster.entries.push({ ...entry, updatedAt: new Date().toISOString() });
  newMaster.updatedAt = new Date().toISOString();
  return newMaster;
}

export function setEntryStatus(master: TermMaster, entryId: string, status: "active" | "inactive"): TermMaster {
  const newMaster = structuredClone(master);
  const entry = newMaster.entries.find((item) => item.id === entryId);
  if (entry) {
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
  }
  newMaster.updatedAt = new Date().toISOString();
  return newMaster;
}

export function removeEntry(master: TermMaster, entryId: string): TermMaster {
  const newMaster = structuredClone(master);
  newMaster.entries = newMaster.entries.filter((item) => item.id !== entryId);
  newMaster.updatedAt = new Date().toISOString();
  return newMaster;
}
