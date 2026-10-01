import type {
  GlossaryBook,
  GlossaryConcept,
  GlossaryTranslation,
  LegacyProject,
  LegacyTermBinding,
  ReviewStatus,
} from "./types";

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const LANGUAGES = ["English", "日本語", "Français", "Deutsch", "한국어", "Español"] as const;
export type ProjectLanguage = (typeof LANGUAGES)[number];

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "草稿",
  pending: "待确认",
  confirmed: "已确认",
  changes: "需修改",
};

const legacyTerm = (source: string, target: string, confirmed = false, required = true): LegacyTermBinding => ({
  id: uid("term"),
  source,
  target,
  required,
  confirmed,
});

/**
 * 内置示例：故意保留“同一批牌子各写一份、译法对不上”的旧数据，
 * 首次打开时由迁移流程合入术语总表并转为引用。
 */
export const createSeedLegacyProject = (): LegacyProject => {
  const signs = [
    {
      id: "sign-platform",
      code: "TR-01",
      sourceText: "候车区。请在黄线内排队，照看好随身物品。",
      targetLanguage: "English",
      targetText: "Waiting Area\nPlease queue behind the yellow line and keep your belongings with you.",
      scenario: "轨道交通站台",
      regulation: "GB/T 10001.1-2023 公共信息图形符号",
      status: "pending" as ReviewStatus,
      terms: [legacyTerm("候车区", "Waiting Area"), legacyTerm("黄线", "yellow line")],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-21T09:20:00.000Z",
    },
    {
      id: "sign-exit",
      code: "EM-02",
      sourceText: "紧急出口。发生紧急情况时，请按指示方向迅速撤离，不要乘坐电梯。",
      targetLanguage: "English",
      targetText: "EMERGENCY EXIT\nIn an emergency, leave quickly in the direction shown. Do not use the elevator.",
      scenario: "商场疏散通道",
      regulation: "GB 13495.1-2015 消防安全标志",
      status: "confirmed" as ReviewStatus,
      terms: [legacyTerm("紧急出口", "EMERGENCY EXIT", true), legacyTerm("电梯", "elevator", true)],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-18T06:10:00.000Z",
    },
    {
      id: "sign-gap",
      code: "TR-05",
      sourceText: "请注意站台间隙。上车时请在黄线后等候。",
      targetLanguage: "English",
      targetText: "Mind the Platform Gap\nWait behind the yellow line when boarding.",
      scenario: "轨道交通站台",
      regulation: "GB/T 10001.1-2023 公共信息图形符号",
      status: "confirmed" as ReviewStatus,
      // 与 TR-01 同批牌子，却各写了一份“黄线”，译法对不上（大写 Y）
      terms: [legacyTerm("站台间隙", "Platform Gap", true), legacyTerm("黄线", "Yellow Line", true)],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-20T07:05:00.000Z",
    },
    {
      id: "sign-water",
      code: "SV-03",
      sourceText: "直饮水。请勿将茶叶、果皮等杂物丢入水槽。",
      targetLanguage: "日本語",
      targetText: "飲料水\n茶殻や果物の皮などを流さないでください。",
      scenario: "公园服务亭",
      regulation: "城市公共设施双语标识译写规范",
      status: "changes" as ReviewStatus,
      terms: [legacyTerm("直饮水", "飲料水"), legacyTerm("水槽", "排水口")],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-23T02:40:00.000Z",
    },
    {
      id: "sign-smoking",
      code: "PR-07",
      sourceText: "禁止吸烟。包括电子烟。",
      targetLanguage: "Français",
      targetText: "INTERDICTION DE FUMER\nCigarettes électroniques incluses.",
      scenario: "医院入口",
      regulation: "公共场所卫生管理条例实施细则",
      status: "draft" as ReviewStatus,
      terms: [legacyTerm("禁止吸烟", "INTERDICTION DE FUMER"), legacyTerm("电子烟", "Cigarettes électroniques")],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-24T04:15:00.000Z",
    },
  ];

  return {
    id: "public-sign-review-1008",
    title: "城市公共标识多语言校对",
    location: "滨海交通枢纽一期",
    activeSignId: signs[0].id,
    signs,
    updatedAt: new Date(0).toISOString(),
  };
};

const BOOK_BASE_TIME = "2026-09-24T08:00:00.000Z";

export function translation(target: string, revision = 1, active = true, note = ""): GlossaryTranslation {
  return { target, active, note, revision, updatedAt: BOOK_BASE_TIME, updatedBy: "术语管理员" };
}

let conceptSeq = 0;
function concept(source: string, translations: Record<string, GlossaryTranslation>): GlossaryConcept {
  conceptSeq += 1;
  return { id: `gloss-${String(conceptSeq).padStart(3, "0")}`, source, translations };
}

/**
 * 内置机构术语总表（也作为总表完全不可读时的最后兜底）。
 * 新用户首次打开且本地没有任何总表数据时，旧示例数据迁移合成的总表以此为准。
 */
export const createSeedGlossary = (): GlossaryBook => {
  conceptSeq = 0;
  return {
    revision: 1,
    updatedAt: BOOK_BASE_TIME,
    concepts: [
      concept("候车区", { English: translation("Waiting Area") }),
      concept("黄线", { English: translation("yellow line") }),
      concept("紧急出口", { English: translation("EMERGENCY EXIT") }),
      concept("电梯", { English: translation("elevator") }),
      concept("站台间隙", { English: translation("Platform Gap") }),
      concept("直饮水", { 日本語: translation("飲料水") }),
      concept("水槽", { 日本語: translation("排水口") }),
      concept("禁止吸烟", { Français: translation("INTERDICTION DE FUMER") }),
      concept("电子烟", { Français: translation("Cigarettes électroniques") }),
    ],
  };
};
