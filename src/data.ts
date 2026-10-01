import type { ReviewStatus, SignItem, SignProject, TermBinding, TermEntry, TermMaster } from "./types";

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "草稿",
  pending: "待确认",
  confirmed: "已确认",
  changes: "需修改",
};

/** 按语种定译法的术语总表（管理员维护） */
export const createSeedMaster = (): TermMaster => {
  const now = "2026-09-20T08:00:00.000Z";
  const entries: TermEntry[] = [
    { id: "term-waiting-area", source: "候车区", language: "English", target: "Waiting Area", status: "active", note: "轨道交通站台标准译法", updatedAt: now },
    { id: "term-yellow-line", source: "黄线", language: "English", target: "yellow line", status: "active", note: "", updatedAt: now },
    { id: "term-emergency-exit", source: "紧急出口", language: "English", target: "EMERGENCY EXIT", status: "active", note: "消防安全标志固定译法", updatedAt: now },
    { id: "term-elevator", source: "电梯", language: "English", target: "elevator", status: "active", note: "", updatedAt: now },
    { id: "term-drinking-water", source: "直饮水", language: "日本語", target: "飲料水", status: "active", note: "", updatedAt: now },
    { id: "term-drain", source: "水槽", language: "日本語", target: "排水口", status: "active", note: "", updatedAt: now },
    { id: "term-no-smoking", source: "禁止吸烟", language: "Français", target: "INTERDICTION DE FUMER", status: "active", note: "", updatedAt: now },
    { id: "term-e-cigarette", source: "电子烟", language: "Français", target: "Cigarettes électroniques", status: "active", note: "", updatedAt: now },
  ];
  return { schema: 1, entries, updatedAt: now };
};

/** 引用总表条目的术语绑定 */
export const bindTerm = (entry: TermEntry, confirmed = false, required = true): TermBinding => ({
  id: uid("bind"),
  entryId: entry.id,
  source: entry.source,
  target: entry.target,
  entryUpdatedAt: entry.updatedAt,
  required,
  confirmed,
  note: "",
  stale: false,
});

export const createSeedProject = (master: TermMaster = createSeedMaster()): SignProject => {
  const byId = (id: string) => master.entries.find((entry) => entry.id === id)!;
  const signs: SignItem[] = [
    {
      id: "sign-platform",
      code: "TR-01",
      sourceText: "候车区。请在黄线内排队，照看好随身物品。",
      targetLanguage: "English",
      targetText: "Waiting Area\nPlease queue behind the yellow line and keep your belongings with you.",
      scenario: "轨道交通站台",
      regulation: "GB/T 10001.1-2023 公共信息图形符号",
      status: "pending",
      terms: [bindTerm(byId("term-waiting-area")), bindTerm(byId("term-yellow-line"))],
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
      status: "confirmed",
      terms: [bindTerm(byId("term-emergency-exit"), true), bindTerm(byId("term-elevator"), true)],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-18T06:10:00.000Z",
    },
    {
      id: "sign-water",
      code: "SV-03",
      sourceText: "直饮水。请勿将茶叶、果皮等杂物丢入水槽。",
      targetLanguage: "日本語",
      targetText: "飲料水\n茶殻や果物の皮などを流さないでください。",
      scenario: "公园服务亭",
      regulation: "城市公共设施双语标识译写规范",
      status: "changes",
      terms: [bindTerm(byId("term-drinking-water")), bindTerm(byId("term-drain"))],
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
      status: "draft",
      terms: [bindTerm(byId("term-no-smoking")), bindTerm(byId("term-e-cigarette"))],
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
    updatedAt: new Date().toISOString(),
  };
};
