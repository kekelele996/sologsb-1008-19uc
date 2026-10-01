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

/** 术语总表条目：管理员按语种定译法 */
export interface TermEntry {
  id: string;
  source: string;
  language: string;
  target: string;
  status: "active" | "inactive";
  note: string;
  updatedAt: string;
}

/** 术语总表：机构统一维护的固定译法 */
export interface TermMaster {
  schema: 1;
  entries: TermEntry[];
  updatedAt: string;
}

/** 引用总表条目的术语绑定：校对台只记引用哪条与本项目确认状态 */
export interface TermBinding {
  id: string;
  /** 引用总表哪条 */
  entryId: string;
  /** 引用时的快照（总表读不出来时照上一版继续校对） */
  source: string;
  target: string;
  entryUpdatedAt: string;
  /** 本项目是否必选 */
  required: boolean;
  /** 本项目确认状态 */
  confirmed: boolean;
  /** 备注留在校对台 */
  note: string;
  /** 总表变更后标出待重新确认 */
  stale: boolean;
  staleReason?: "changed" | "deactivated" | "missing";
}

export interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  sourceText: string;
  targetText: string;
  status: ReviewStatus;
  terms: TermBinding[];
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
  terms: TermBinding[];
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
  updatedAt: string;
}

export interface PersistedProject {
  schema: 1;
  project: SignProject;
}

export interface PersistedMaster {
  schema: 1;
  master: TermMaster;
}

export interface DiffToken {
  type: "same" | "add" | "remove";
  value: string;
}

/** 总表读取结果：失败时回退到快照继续校对 */
export interface MasterLoadResult {
  master: TermMaster | null;
  ok: boolean;
  error?: string;
}

/** 同步结果统计 */
export interface SyncReport {
  changed: number;
  deactivated: number;
  missing: number;
  reactivated: number;
}
