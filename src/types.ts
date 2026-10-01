export type ReviewStatus = "draft" | "pending" | "confirmed" | "changes";

export interface Reply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: Reply[];
}

/** 总表中某语种的一条译法。管理员按语种定译法，可停用，改动后 revision +1。 */
export interface GlossaryTranslation {
  target: string;
  active: boolean;
  note: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

/** 总表术语条目：一个中文源语概念，下挂各语种译法。 */
export interface GlossaryConcept {
  id: string;
  source: string;
  translations: Record<string, GlossaryTranslation>;
}

/** 机构术语总表（唯一权威译法来源）。 */
export interface GlossaryBook {
  revision: number;
  updatedAt: string;
  concepts: GlossaryConcept[];
}

/**
 * 校对台上某条标识对总表条目的引用。
 * 校对台不存译法正文，只记引用哪条、是否必选、本项目确认状态；
 * seen* 记录上次确认时看到的总表状态，用于发现总表改动与“两边都动过”。
 */
export interface TermRef {
  id: string;
  termId: string;
  required: boolean;
  confirmed: boolean;
  /** 总表改了译法或停用：译文不改写，只标待重新确认。 */
  pendingReconfirm: boolean;
  /** 校对台侧也动过该译法（如迁移时与合成译法不一致），与总表冲突时以总表为准。 */
  localEdited: boolean;
  seenTarget: string;
  seenActive: boolean;
  seenRevision: number;
  /** 校对台备注：同步、冲突处理记录都留在这。 */
  notes: string[];
}

export interface SnapshotTerm {
  termId: string;
  source: string;
  target: string;
  required: boolean;
  active: boolean;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  sourceText: string;
  targetText: string;
  status: ReviewStatus;
  terms: SnapshotTerm[];
}

export interface SignItem {
  id: string;
  code: string;
  sourceText: string;
  targetLanguage: string;
  targetText: string;
  scenario: string;
  regulation: string;
  status: ReviewStatus;
  terms: TermRef[];
  comments: ReviewComment[];
  versions: VersionSnapshot[];
  emergencyRevision: boolean;
  updatedAt: string;
}

export interface SignProject {
  id: string;
  title: string;
  location: string;
  activeSignId: string;
  signs: SignItem[];
  migration?: MigrationInfo;
  updatedAt: string;
}

export interface MigrationInfo {
  migratedAt: string;
  /** 同一条牌子内重复绑定而丢弃的数量。 */
  mergedBindings: number;
  /** 跨牌子（同一源语+语种）重复、合成同一条总表条目的数量。 */
  dedupedBindings: number;
  /** 合成/补入总表的术语条目数。 */
  createdConcepts: number;
  /** 译法不一致、标记待重新确认的引用数。 */
  reconfirmOnConflict: number;
  noticeDismissed?: boolean;
}

export interface PersistedProject {
  schema: 2;
  project: SignProject;
}

/* ---------- 旧版（schema 1）结构，仅供迁移使用 ---------- */

export interface LegacyTermBinding {
  id: string;
  source: string;
  target: string;
  required: boolean;
  confirmed: boolean;
}

export interface LegacyVersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  sourceText: string;
  targetText: string;
  status: ReviewStatus;
  terms: LegacyTermBinding[];
}

export interface LegacySignItem {
  id: string;
  code: string;
  sourceText: string;
  targetLanguage: string;
  targetText: string;
  scenario: string;
  regulation: string;
  status: ReviewStatus;
  terms: LegacyTermBinding[];
  comments: ReviewComment[];
  versions: LegacyVersionSnapshot[];
  emergencyRevision: boolean;
  updatedAt: string;
}

export interface LegacyProject {
  id: string;
  title: string;
  location: string;
  activeSignId: string;
  signs: LegacySignItem[];
  updatedAt: string;
}

export interface PersistedLegacyProject {
  schema: 1;
  project: LegacyProject;
}

export interface DiffToken {
  type: "same" | "add" | "remove";
  value: string;
}
