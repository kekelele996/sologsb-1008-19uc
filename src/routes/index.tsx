import { $, component$, useSignal, useVisibleTask$, type QRL } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { createSeedLegacyProject, LANGUAGES, STATUS_LABELS } from "../data";
import { analyzeSign, diffText } from "../utils";
import {
  cacheGlossary,
  conceptById,
  confirmRef,
  isGlossaryFault,
  loadGlossary,
  migrateLegacyProject,
  publishGlossary,
  resolveSignTerms,
  resolveTerm,
  setGlossaryFault,
  syncProject,
  syncSign,
  snapshotTerms,
  type GlossarySource,
  type ResolvedTerm,
} from "../glossary";
import type {
  GlossaryBook,
  GlossaryConcept,
  LegacyProject,
  Reply,
  ReviewComment,
  ReviewStatus,
  SignItem,
  SignProject,
  TermRef,
  VersionSnapshot,
} from "../types";

const PROJECT_KEY_V2 = "sologsb-1008-project-v2";
const PROJECT_KEY_V1 = "sologsb-1008-project-v1";
const WIDTHS = [320, 480, 720, 960] as const;

export const head: DocumentHead = {
  title: "公共标识多语言校对台",
  meta: [
    { name: "description", content: "公共标识译文、术语引用、版本和版面风险校对工作台" },
  ],
};

function statusClass(status: ReviewStatus) {
  if (status === "confirmed") return "badge-success";
  if (status === "changes") return "badge-error";
  if (status === "pending") return "badge-warning";
  return "badge-neutral";
}

const SOURCE_LABELS: Record<GlossarySource, string> = {
  master: "总表权威版",
  cache: "上一版缓存",
  bundled: "内置兜底总表",
};

export default component$(() => {
  const project = useSignal<SignProject | null>(null);
  const glossary = useSignal<GlossaryBook | null>(null);
  const glossarySource = useSignal<GlossarySource>("master");
  const degraded = useSignal(false);
  const loadAttempts = useSignal(1);
  const retrying = useSignal(false);
  const past = useSignal<SignProject[]>([]);
  const future = useSignal<SignProject[]>([]);
  const hydrated = useSignal(false);
  const online = useSignal(true);
  const previewWidth = useSignal(480);
  const previewFont = useSignal(42);
  const selectedVersionId = useSignal("");
  const bindConceptId = useSignal("");
  const adminOpen = useSignal(false);
  const adminNewSource = useSignal("");
  const adminNewLang = useSignal<string>(LANGUAGES[0]);
  const adminNewTarget = useSignal("");
  const commentDraft = useSignal("");
  const replyDraft = useSignal("");
  const replyingTo = useSignal("");
  const toast = useSignal("");
  const previewId = useSignal("");
  const readOnly = useSignal(false);

  const active = (): SignItem => {
    const p = project.value;
    if (!p) throw new Error("project not loaded");
    return p.signs.find((sign) => sign.id === (previewId.value || p.activeSignId)) ?? p.signs[0];
  };

  const activeBook = (): GlossaryBook => {
    const book = glossary.value;
    if (!book) throw new Error("glossary not loaded");
    return book;
  };

  const resolvedActive = () => resolveSignTerms(active(), activeBook());

  /** 管理员侧总表变更：发布后同步到引用，译文不改写，只打待重新确认标记。 */
  const applyGlossary = $(async (next: GlossaryBook, label: string) => {
    publishGlossary(next);
    const counts = syncProject(project.value!, next);
    glossary.value = structuredClone(next);
    project.value = structuredClone(project.value);
    const parts = [
      counts.reconfirmed ? `${counts.reconfirmed} 条待重新确认` : "",
      counts.deactivated ? `${counts.deactivated} 条被停用` : "",
      counts.conflicts ? `${counts.conflicts} 条两边都动过（以总表为准）` : "",
    ].filter(Boolean);
    toast.value = `${label}已发布${parts.length ? `：${parts.join("，")}` : "，引用无需重新确认"}`;
  });

  const commit = $((label: string, update: (draft: SignProject) => void) => {
    past.value = [...past.value.slice(-49), structuredClone(project.value!)];
    future.value = [];
    const draft = structuredClone(project.value!);
    update(draft);
    draft.updatedAt = new Date().toISOString();
    project.value = draft;
  });

  const updateActive = $((label: string, update: (sign: SignItem, draft: SignProject) => void) => {
    commit(label, (draft) => {
      const sign = draft.signs.find((item: SignItem) => item.id === draft.activeSignId);
      if (sign) update(sign, draft);
    });
  });

  const undo = $(() => {
    if (!past.value.length) return;
    const previous = past.value.at(-1)!;
    future.value = [structuredClone(project.value!), ...future.value].slice(0, 50);
    past.value = past.value.slice(0, -1);
    project.value = previous;
    toast.value = "已撤销";
  });

  const redo = $(() => {
    if (!future.value.length) return;
    const next = future.value[0];
    past.value = [...past.value.slice(-49), structuredClone(project.value!)];
    future.value = future.value.slice(1);
    project.value = next;
    toast.value = "已重做";
  });

  const navigateSign = $((direction: 1 | -1) => {
    if (readOnly.value) return;
    const signs = project.value!.signs;
    const index = Math.max(0, signs.findIndex((sign) => sign.id === project.value!.activeSignId));
    const nextSign = signs[(index + direction + signs.length) % signs.length];
    commit("切换标识", (draft) => { draft.activeSignId = nextSign.id; });
    selectedVersionId.value = "";
  });

  const setStatus = $((status: ReviewStatus) => {
    commit("更新审校状态", (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!sign) return;
      if (sign.emergencyRevision && status === "confirmed") {
        sign.status = "pending";
      } else {
        sign.status = status;
      }
    });
  });

  const toggleEmergency = $(() => {
    commit("切换紧急修订", (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!sign) return;
      sign.emergencyRevision = !sign.emergencyRevision;
      if (sign.emergencyRevision) sign.status = "changes";
    });
  });

  const saveVersion = $(() => {
    const current = project.value!.signs.find((item) => item.id === project.value!.activeSignId);
    if (!current) return;
    const versionId = `version-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    commit("保存版本快照", (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!sign) return;
      sign.versions.unshift({
        id: versionId,
        label: `版本 ${sign.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        sourceText: sign.sourceText,
        targetText: sign.targetText,
        status: sign.status,
        terms: snapshotTerms(sign, glossary.value!),
      });
      sign.versions = sign.versions.slice(0, 12);
    });
    selectedVersionId.value = versionId;
    toast.value = "版本快照已保存（术语随总表当前译法存档）";
  });

  const bindTerm = $(() => {
    const conceptId = bindConceptId.value;
    const sign = active();
    if (!conceptId || sign.terms.some((ref: TermRef) => ref.termId === conceptId)) return;
    const resolved = resolveTerm(
      { id: "", termId: conceptId, required: true, confirmed: false, pendingReconfirm: false, localEdited: false, seenTarget: "", seenActive: true, seenRevision: 0, notes: [] },
      sign.targetLanguage,
      glossary.value!,
    );
    if (!resolved.tr || !resolved.tr.active) return;
    updateActive("引用总表术语", (target) => {
      target.terms.push({
        id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        termId: conceptId,
        required: true,
        confirmed: false,
        pendingReconfirm: false,
        localEdited: false,
        seenTarget: resolved.tr!.target,
        seenActive: true,
        seenRevision: resolved.tr!.revision,
        notes: [`${new Date().toISOString()} 校对台新增引用，译法以总表为准。`],
      });
      target.status = "pending";
    });
    bindConceptId.value = "";
  });

  const confirmTerm = $((refId: string) => {
    updateActive("确认术语引用", (sign) => {
      confirmRef(sign, refId, glossary.value!);
    });
  });

  const addComment = $(() => {
    const body = commentDraft.value.trim();
    if (!body) return;
    updateActive("添加审校意见", (sign) => {
      sign.comments.unshift({
        id: `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        author: "当前审校员",
        body,
        createdAt: new Date().toISOString(),
        resolved: false,
        replies: [],
      });
      sign.status = sign.status === "confirmed" ? "changes" : sign.status;
    });
    commentDraft.value = "";
  });

  const addReply = $((commentId: string) => {
    const body = replyDraft.value.trim();
    if (!body) return;
    updateActive("回复审校意见", (sign) => {
      const comment = sign.comments.find((item: ReviewComment) => item.id === commentId);
      comment?.replies.push({
        id: `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        author: "当前审校员",
        body,
        createdAt: new Date().toISOString(),
      });
    });
    replyDraft.value = "";
    replyingTo.value = "";
  });

  const sharePreview: QRL<() => void> = $(() => {
    const current = active();
    const url = `${window.location.origin}${window.location.pathname}?preview=${encodeURIComponent(current.id)}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    toast.value = "只读预览链接已复制";
  });

  const retryGlossary = $(async () => {
    retrying.value = true;
    const result = await loadGlossary();
    retrying.value = false;
    degraded.value = result.degraded;
    glossarySource.value = result.source;
    loadAttempts.value = result.attempts;
    if (!result.degraded) {
      cacheGlossary(result.book);
      const counts = syncProject(project.value!, result.book);
      glossary.value = structuredClone(result.book);
      project.value = structuredClone(project.value);
      toast.value = `总表连接已恢复（${SOURCE_LABELS[result.source]}）${
        counts.reconfirmed || counts.deactivated ? "，已重新同步引用标记" : ""
      }`;
    } else {
      toast.value = "重试仍失败，继续照上一版校对";
    }
  });

  const toggleFault = $(async () => {
    const next = !isGlossaryFault();
    setGlossaryFault(next);
    if (next) {
      retrying.value = true;
      const result = await loadGlossary();
      retrying.value = false;
      degraded.value = result.degraded;
      glossarySource.value = result.source;
      loadAttempts.value = result.attempts;
      toast.value = result.degraded
        ? `总表读取失败（重试 ${result.attempts} 次），已照「${SOURCE_LABELS[result.source]}」继续校对`
        : "已模拟读取故障";
    } else {
      await retryGlossary();
    }
  });

  const adminSaveTarget = $((conceptId: string, language: string, element: HTMLInputElement) => {
    const target = element.value.trim();
    const book = structuredClone(glossary.value!) as GlossaryBook;
    const concept = conceptById(book, conceptId);
    if (!concept) return;
    const tr = concept.translations[language];
    if (!tr || target === tr.target) return;
    tr.target = target;
    tr.active = true;
    tr.revision += 1;
    tr.updatedAt = new Date().toISOString();
    tr.updatedBy = "术语管理员";
    tr.note = tr.note || "管理员定译";
    book.revision += 1;
    void applyGlossary(book, `「${concept.source} · ${language}」译法修改`);
  });

  const adminToggleActive = $((conceptId: string, language: string) => {
    const book = structuredClone(glossary.value!) as GlossaryBook;
    const concept = conceptById(book, conceptId);
    const tr = concept?.translations[language];
    if (!concept || !tr) return;
    tr.active = !tr.active;
    tr.revision += 1;
    tr.updatedAt = new Date().toISOString();
    tr.updatedBy = "术语管理员";
    book.revision += 1;
    void applyGlossary(book, `「${concept.source} · ${language}」${tr.active ? "启用" : "停用"}`);
  });

  const adminAddConcept = $(() => {
    const source = adminNewSource.value.trim();
    const target = adminNewTarget.value.trim();
    const language = adminNewLang.value;
    if (!source || !target) return;
    const book = structuredClone(glossary.value!) as GlossaryBook;
    let concept = book.concepts.find((item: GlossaryConcept) => item.source === source);
    if (!concept) {
      const seq = book.concepts.length + 1;
      concept = {
        id: `gloss-${String(seq).padStart(3, "0")}-${Date.now().toString(36)}`,
        source,
        translations: {},
      };
      book.concepts.push(concept);
    }
    if (concept.translations[language]) {
      toast.value = "该语种译法已存在，请直接在条目上修改";
      return;
    }
    concept.translations[language] = {
      target,
      active: true,
      note: "管理员定译",
      revision: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: "术语管理员",
    };
    book.revision += 1;
    adminNewSource.value = "";
    adminNewTarget.value = "";
    void applyGlossary(book, `新增总表条目「${source} · ${language}」`);
  });

  const preview = () => analyzeSign(active(), previewWidth.value, previewFont.value, resolvedActive());
  const selectedVersion = () => active().versions.find((version: VersionSnapshot) => version.id === selectedVersionId.value) ?? active().versions[0];

  // 启动：读总表（失败侧重试 + 上一版兜底）→ 迁移旧数据 → 同步引用
  useVisibleTask$(async () => {
    const result = await loadGlossary();
    glossary.value = result.book;
    glossarySource.value = result.source;
    degraded.value = result.degraded;
    loadAttempts.value = result.attempts;
    if (!result.degraded) cacheGlossary(result.book);

    let nextProject: SignProject;
    let bookForProject = result.book;
    try {
      const rawV2 = localStorage.getItem(PROJECT_KEY_V2);
      const rawV1 = !rawV2 ? localStorage.getItem(PROJECT_KEY_V1) : null;
      if (rawV2) {
        const stored = JSON.parse(rawV2) as { schema: number; project: SignProject };
        if (stored.schema === 2 && stored.project?.signs?.length) {
          nextProject = stored.project;
        } else {
          throw new Error("malformed v2");
        }
      } else {
        // 旧数据第一次打开：迁移进引用模型，重复的合成一条
        const legacy = rawV1
          ? (JSON.parse(rawV1) as { schema: 1; project: LegacyProject }).project
          : createSeedLegacyProject();
        const migrated = migrateLegacyProject(legacy, result.book);
        nextProject = migrated.project;
        bookForProject = migrated.book;
        glossary.value = migrated.book;
        // 故障期间不覆盖权威总表，迁移合成条目仅在本次会话使用，恢复后再合入
        if (result.source === "master" || result.source === "bundled") publishGlossary(migrated.book);
      }
      // 总表相对引用有更新：只打标，不改译文
      syncProject(nextProject, bookForProject);
      project.value = nextProject;

      const requestedPreview = new URLSearchParams(window.location.search).get("preview") ?? "";
      previewId.value = requestedPreview;
      readOnly.value = Boolean(requestedPreview);
    } catch {
      // 存储损坏时用内置旧数据走一遍迁移，保证可打开
      const migrated = migrateLegacyProject(createSeedLegacyProject(), glossary.value);
      syncProject(migrated.project, migrated.book);
      project.value = migrated.project;
      glossary.value = migrated.book;
    }
    hydrated.value = true;
  });

  useVisibleTask$(({ track, cleanup }) => {
    track(() => hydrated.value);
    if (!hydrated.value) return;
    track(() => project.value);
    const timer = window.setTimeout(() => {
      if (project.value) {
        localStorage.setItem(PROJECT_KEY_V2, JSON.stringify({ schema: 2, project: project.value }));
      }
    }, 450);
    cleanup(() => window.clearTimeout(timer));
  });

  useVisibleTask$(({ cleanup }) => {
    const updateOnline = () => { online.value = navigator.onLine; };
    updateOnline();
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        void navigateSign(1);
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        void navigateSign(-1);
      } else if (event.key === "[") {
        const index = WIDTHS.indexOf(previewWidth.value as (typeof WIDTHS)[number]);
        previewWidth.value = WIDTHS[Math.max(0, index - 1)];
      } else if (event.key === "]") {
        const index = WIDTHS.indexOf(previewWidth.value as (typeof WIDTHS)[number]);
        previewWidth.value = WIDTHS[Math.min(WIDTHS.length - 1, index + 1)];
      } else if (event.key === "-") {
        previewFont.value = Math.max(28, previewFont.value - 4);
      } else if (event.key === "=") {
        previewFont.value = Math.min(88, previewFont.value + 4);
      }
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("keydown", keydown);
    cleanup(() => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("keydown", keydown);
    });
  });

  if (!project.value || !glossary.value) {
    return (
      <main data-theme="corporate" class="grid min-h-screen place-items-center bg-slate-100 text-slate-500">
        <div class="text-center">
          <div class="loading loading-spinner loading-lg text-primary"></div>
          <p class="mt-4 text-sm">正在读取术语总表…失败会自动按侧重试，并回退上一版。</p>
        </div>
      </main>
    );
  }

  if (readOnly.value) {
    const sign = active();
    const resolved = resolveSignTerms(sign, glossary.value);
    const analysis = analyzeSign(sign, previewWidth.value, previewFont.value, resolved);
    return (
      <main data-theme="corporate" class="min-h-screen bg-slate-100 p-6">
        <div class="mx-auto max-w-5xl">
          <div class="mb-4 flex items-center justify-between">
            <div>
              <div class="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Read-only preview</div>
              <h1 class="text-2xl font-bold text-slate-800">{sign.code} · {sign.scenario}</h1>
            </div>
            <span class={`badge ${statusClass(sign.status)}`}>{STATUS_LABELS[sign.status]}</span>
          </div>
          <section class="rounded-3xl bg-white p-14 shadow-xl">
            <div class="mb-3 text-center text-xs text-slate-400">中文原文</div>
            <p class="mx-auto mb-10 max-w-2xl text-center text-lg text-slate-600">{sign.sourceText}</p>
            <div class="mx-auto border-y-4 border-slate-800 py-10 text-center">
              <p class="whitespace-pre-line font-black leading-tight tracking-wide text-slate-900" style={{ fontSize: `${previewFont.value}px` }}>{analysis.visible.join("\n")}</p>
            </div>
            <div class="mt-5 text-center text-sm text-slate-500">{sign.targetLanguage} · {sign.regulation}</div>
          </section>
          <p class="mt-4 text-center text-xs text-slate-400">此链接读取当前浏览器中的本地版本，仅用于演示只读预览。</p>
        </div>
      </main>
    );
  }

  const proj = project.value;
  const book = glossary.value;
  const migration = proj.migration;
  const bindableConcepts = book.concepts.filter(
    (concept: GlossaryConcept) =>
      concept.translations[active().targetLanguage]?.active &&
      !active().terms.some((ref: TermRef) => ref.termId === concept.id),
  );

  return (
    <div data-theme="corporate" class="min-h-screen bg-slate-100 pb-9 text-slate-800">
      <header class="navbar sticky top-0 z-40 min-h-16 border-b border-slate-700 bg-[#17324d] px-5 text-white shadow-lg">
        <div class="navbar-start gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 font-black">译</div>
          <div>
            <div class="text-xs uppercase tracking-[0.2em] text-sky-200">Public Sign Review</div>
            <div class="font-bold">公共标识多语言校对台</div>
          </div>
        </div>
        <div class="navbar-center hidden xl:flex">
          <input
            class="input input-sm w-80 border-white/15 bg-white/10 text-white placeholder:text-slate-300"
            value={proj.title}
            onInput$={(_, element) => commit("修改项目名称", (draft) => { draft.title = element.value; })}
            aria-label="项目名称"
          />
        </div>
        <div class="navbar-end gap-2">
          <span class="hidden badge badge-ghost badge-sm lg:inline-flex" title={`总表 revision ${book.revision}`}>
            术语总表：{SOURCE_LABELS[glossarySource.value]}
          </span>
          <span class={`badge ${online.value ? "badge-success" : "badge-warning"} badge-outline`}>{online.value ? "在线" : "离线草稿"}</span>
          <button class="btn btn-ghost btn-sm" disabled={!past.value.length} onClick$={undo}>撤销</button>
          <button class="btn btn-ghost btn-sm" disabled={!future.value.length} onClick$={redo}>重做</button>
          <button class="btn btn-sm border-white/20 bg-white/10 text-white hover:bg-white/20" onClick$={() => { adminOpen.value = true; }}>
            术语总表（管理员）
          </button>
          <button class="btn btn-sm border-white/20 bg-white/10 text-white hover:bg-white/20" onClick$={sharePreview}>复制只读链接</button>
          <button class={`btn btn-sm ${active().emergencyRevision ? "btn-error" : "btn-warning"}`} onClick$={toggleEmergency}>
            {active().emergencyRevision ? "退出紧急修订" : "紧急修订"}
          </button>
        </div>
      </header>

      {degraded.value && (
        <div class="alert alert-warning sticky top-16 z-30 rounded-none border-x-0 py-2">
          <span class="text-lg">!</span>
          <span class="flex-1">
            <strong>术语总表读不出来</strong>：已按侧重试 {loadAttempts.value} 次仍失败，正在照「{SOURCE_LABELS[glossarySource.value]}」继续校对；故障期间管理员的改译、停用不会下发。
          </span>
          <button class="btn btn-sm btn-outline" disabled={retrying.value} onClick$={retryGlossary}>
            {retrying.value ? "重试中…" : "重新连接"}
          </button>
          <button class="btn btn-sm btn-ghost" onClick$={toggleFault} title="演示用：开关总表读取故障">
            {isGlossaryFault() ? "清除模拟故障" : "模拟读取故障"}
          </button>
        </div>
      )}

      {!degraded.value && (
        <div class="flex justify-end bg-amber-50 px-4 py-1 text-[11px] text-amber-700">
          <button class="underline underline-offset-2" onClick$={toggleFault}>演示：模拟总表读取故障</button>
        </div>
      )}

      {migration && !migration.noticeDismissed && (
        <div class="alert alert-info rounded-none border-x-0 py-2">
          <span class="text-lg">↪</span>
          <span class="flex-1 text-sm">
            <strong>旧数据已迁移到术语引用：</strong>
            重复术语已合成总表一条（跨牌子合并 {migration.dedupedBindings} 处，牌子内重复绑定合并 {migration.mergedBindings} 处，新合成总表条目 {migration.createdConcepts} 条）；
            {migration.reconfirmOnConflict > 0
              ? `其中 ${migration.reconfirmOnConflict} 处引用旧译法与总表不一致，已按“以总表为准”标为待重新确认，备注留在校对台。`
              : "各牌子译法一致，无需重新确认。"}
          </span>
          <button
            class="btn btn-sm btn-ghost"
            onClick$={() => commit("关闭迁移提示", (draft) => { if (draft.migration) draft.migration.noticeDismissed = true; })}
          >
            知道了
          </button>
        </div>
      )}

      {active().emergencyRevision && (
        <div class="alert alert-error rounded-none border-x-0 py-2 text-white">
          <span class="text-lg">!</span>
          <span><strong>紧急修订模式</strong>：确认操作已锁定，修改后必须重新审校并保存版本。</span>
        </div>
      )}

      <div class="grid min-h-[calc(100vh-64px)] grid-cols-[270px_minmax(560px,1fr)_430px] gap-px bg-slate-300">
        <aside class="overflow-y-auto bg-slate-50 p-3">
          <div class="mb-3 rounded-xl bg-white p-4 shadow-sm">
            <div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">标识清单</div>
            <div class="mt-1 text-lg font-bold text-slate-800">{proj.signs.length} 处标识</div>
            <p class="mt-1 text-xs leading-5 text-slate-500">{proj.location}</p>
          </div>
          <div class="space-y-2">
            {proj.signs.map((sign: SignItem, index: number) => {
              const risk = analyzeSign(sign, previewWidth.value, previewFont.value, resolveSignTerms(sign, book));
              const pendingTerms = sign.terms.filter((ref: TermRef) => ref.pendingReconfirm).length;
              return (
                <button
                  key={sign.id}
                  class={`w-full rounded-xl border p-3 text-left transition ${sign.id === proj!.activeSignId ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  onClick$={() => {
                    commit("切换标识", (draft) => { draft.activeSignId = sign.id; });
                    selectedVersionId.value = "";
                  }}
                >
                  <div class="flex items-center justify-between">
                    <span class="font-mono text-xs font-bold text-slate-500">{sign.code}</span>
                    <span class={`badge badge-sm ${statusClass(sign.status)}`}>{STATUS_LABELS[sign.status]}</span>
                  </div>
                  <div class="mt-2 line-clamp-2 text-sm font-semibold text-slate-700">{sign.sourceText}</div>
                  <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{sign.targetLanguage}{pendingTerms > 0 ? <span class="ml-1 font-bold text-warning">· {pendingTerms} 术语待确认</span> : ""}</span>
                    <span class={risk.risk === "high" ? "font-bold text-error" : risk.risk === "medium" ? "font-bold text-warning" : "text-success"}>
                      {risk.risk === "high" ? "高风险" : risk.risk === "medium" ? "需留意" : "版面正常"}
                    </span>
                  </div>
                  <span class="sr-only">第 {index + 1} 条</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main class="min-w-0 bg-white">
          <div class="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <div class="flex items-start justify-between gap-5">
              <div>
                <div class="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">{active().code} · {active().scenario}</div>
                <h1 class="mt-1 text-xl font-bold">中文原文与译文校对</h1>
              </div>
              <div class="join">
                {(["draft", "pending", "changes", "confirmed"] as ReviewStatus[]).map((status) => (
                  <button key={status} class={`btn join-item btn-sm ${active().status === status ? "btn-primary" : "btn-outline"}`} onClick$={() => setStatus(status)}>{STATUS_LABELS[status]}</button>
                ))}
              </div>
            </div>
          </div>

          <div class="space-y-5 p-6">
            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body gap-4 p-5">
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Source</div><h2 class="font-bold">中文原文</h2></div>
                  <span class="badge badge-ghost">简体中文</span>
                </div>
                <textarea
                  class="textarea textarea-bordered min-h-24 w-full text-base leading-7"
                  value={active().sourceText}
                  onInput$={(_, element) => updateActive("修改中文原文", (sign) => { sign.sourceText = element.value; sign.status = "draft"; })}
                />
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body gap-4 p-5">
                <div class="grid grid-cols-2 gap-4">
                  <label class="form-control">
                    <span class="label-text mb-1 text-xs font-bold text-slate-500">目标语言</span>
                    <select
                      class="select select-bordered"
                      value={active().targetLanguage}
                      onChange$={(_, element) => updateActive("修改目标语言", (sign) => {
                        sign.targetLanguage = element.value;
                        sign.status = "pending";
                        // 换语种后按新语种总表重新打标
                        syncSign(sign, book, new Date().toISOString());
                      })}
                    >
                      {LANGUAGES.map((language: string) => <option key={language}>{language}</option>)}
                    </select>
                  </label>
                  <label class="form-control">
                    <span class="label-text mb-1 text-xs font-bold text-slate-500">适用场景</span>
                    <input class="input input-bordered" value={active().scenario} onInput$={(_, element) => updateActive("修改适用场景", (sign) => { sign.scenario = element.value; })} />
                  </label>
                </div>
                <label class="form-control">
                  <span class="label-text mb-1 text-xs font-bold text-slate-500">法规或规范提示</span>
                  <input class="input input-bordered" value={active().regulation} onInput$={(_, element) => updateActive("修改法规提示", (sign) => { sign.regulation = element.value; })} />
                </label>
                <div class="divider my-0"></div>
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Target</div><h2 class="font-bold">目标语言译文</h2></div>
                  <button class="btn btn-sm btn-outline" onClick$={saveVersion}>保存版本快照</button>
                </div>
                <textarea
                  class="textarea textarea-bordered min-h-36 w-full text-lg leading-8"
                  value={active().targetText}
                  onInput$={(_, element) => updateActive("修改译文", (sign, draft) => {
                    const previous = sign.targetText;
                    const next = element.value;
                    // 校对台侧改掉了某术语在译文中的写法：记下“本项目也动过”，
                    // 之后管理员再改该条时按“两边都动过、以总表为准”处理。
                    const haystackPrev = previous.toLocaleLowerCase();
                    const haystackNext = next.toLocaleLowerCase();
                    for (const ref of sign.terms) {
                      const resolved = resolveTerm(ref, sign.targetLanguage, book);
                      const canonical = resolved.canonicalTarget?.toLocaleLowerCase();
                      if (canonical && haystackPrev.includes(canonical) && !haystackNext.includes(canonical)) {
                        ref.localEdited = true;
                        ref.notes.unshift(`${new Date().toISOString()} 校对台在译文中改动了该术语写法，若总表随后更新，以总表为准。`);
                        ref.notes = ref.notes.slice(0, 8);
                      }
                    }
                    void draft;
                    sign.targetText = next;
                    sign.status = sign.emergencyRevision ? "changes" : "pending";
                  })}
                />
                <div class="flex flex-wrap gap-2">
                  {resolvedActive().map((item: ResolvedTerm) => {
                    const matched = item.canonicalTarget !== null && active().targetText.toLocaleLowerCase().includes(item.canonicalTarget.toLocaleLowerCase());
                    const cls = item.deactivated || item.missingLanguage || !item.canonicalTarget
                      ? "badge-error"
                      : item.ref.pendingReconfirm
                        ? "badge-warning"
                        : matched && item.ref.confirmed
                          ? "badge-success"
                          : matched
                            ? "badge-info"
                            : "badge-error";
                    const icon = item.deactivated ? "停" : item.missingLanguage ? "缺" : item.ref.pendingReconfirm ? "↻" : matched ? (item.ref.confirmed ? "✓" : "!") : "×";
                    return (
                      <button
                        key={item.ref.id}
                        title={item.ref.notes[0] ?? "点击确认该引用"}
                        class={`badge badge-lg gap-1 ${cls}`}
                        onClick$={() => confirmTerm(item.ref.id)}
                      >
                        {item.concept?.source ?? item.ref.termId} → {item.canonicalTarget ?? "（总表不可用）"} {icon}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <div class="flex items-center justify-between">
                  <div>
                    <h2 class="font-bold">术语引用</h2>
                    <p class="text-xs text-slate-500">译法由机构术语总表按语种统一维护；本台只记引用哪条和本项目确认状态。管理员改译或停用后，译文不改写，只标待重新确认。</p>
                  </div>
                  <span class="badge badge-outline">{active().terms.length} 条引用</span>
                </div>
                <div class="mt-4 grid grid-cols-[1fr_auto] gap-2">
                  <select
                    class="select select-sm select-bordered"
                    value={bindConceptId.value}
                    onChange$={(_, element) => { bindConceptId.value = element.value; }}
                  >
                    <option value="">{bindableConcepts.length ? "从总表选择术语引用…" : "当前语种下可引用的总表条目都已绑定"}</option>
                    {bindableConcepts.map((concept: GlossaryConcept) => (
                      <option key={concept.id} value={concept.id}>
                        {concept.source + " → " + concept.translations[active().targetLanguage]!.target}
                      </option>
                    ))}
                  </select>
                  <button class="btn btn-sm btn-primary" disabled={!bindConceptId.value} onClick$={bindTerm}>引用</button>
                </div>
                <div class="mt-3 grid gap-2">
                  {resolvedActive().map((item: ResolvedTerm) => {
                    const drifts = item.canonicalTarget !== null && item.ref.seenTarget !== item.canonicalTarget;
                    const matched = item.canonicalTarget !== null && active().targetText.toLocaleLowerCase().includes(item.canonicalTarget.toLocaleLowerCase());
                    return (
                      <div key={item.ref.id} class={`rounded-lg border px-3 py-2 ${item.ref.pendingReconfirm ? "border-warning bg-warning/10" : "border-slate-200"}`}>
                        <div class="flex items-center justify-between gap-3">
                          <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-1 text-xs font-bold">
                              <span>{item.concept?.source ?? "未知条目"}</span>
                              <span class="text-slate-400">→</span>
                              <span>{item.canonicalTarget ?? "—"}</span>
                              {item.ref.required && <span class="badge badge-xs badge-ghost">必选</span>}
                              {item.deactivated && <span class="badge badge-xs badge-error">总表已停用</span>}
                              {item.missingLanguage && <span class="badge badge-xs badge-error">总表缺该语种</span>}
                              {item.ref.pendingReconfirm && <span class="badge badge-xs badge-warning">待重新确认</span>}
                              {item.ref.confirmed && !item.ref.pendingReconfirm && <span class="badge badge-xs badge-success">本项目已确认</span>}
                              {item.ref.localEdited && <span class="badge badge-xs badge-ghost" title="两边都动过时以总表为准">本项目动过</span>}
                              {!matched && item.canonicalTarget !== null && <span class="badge badge-xs badge-error">译文未命中</span>}
                            </div>
                            {drifts && (
                              <div class="mt-1 text-[11px] text-slate-500">
                                上次确认时总表译法为「{item.ref.seenTarget}」，管理员已改为「{item.canonicalTarget}」；标识译文保持原样，请核对后确认。
                              </div>
                            )}
                            {item.ref.notes[0] && <div class="mt-1 truncate text-[11px] text-slate-400" title={item.ref.notes[0]}>备注：{item.ref.notes[0]}</div>}
                          </div>
                          <div class="flex shrink-0 gap-1">
                            <button
                              class="btn btn-xs btn-success"
                              disabled={item.ref.pendingReconfirm === false && item.ref.confirmed}
                              onClick$={() => confirmTerm(item.ref.id)}
                            >
                              确认
                            </button>
                            <button
                              class="btn btn-xs btn-ghost"
                              title="切换必选"
                              onClick$={() => updateActive("切换术语必选", (sign) => {
                                const target = sign.terms.find((entry: TermRef) => entry.id === item.ref.id);
                                if (target) target.required = !target.required;
                              })}
                            >
                              {item.ref.required ? "取消必选" : "设为必选"}
                            </button>
                            <button
                              class="btn btn-xs btn-ghost text-error"
                              onClick$={() => updateActive("移除术语引用", (sign) => { sign.terms = sign.terms.filter((entry: TermRef) => entry.id !== item.ref.id); })}
                            >
                              移除
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {active().terms.length === 0 && (
                    <div class="rounded-xl border border-dashed p-5 text-center text-xs text-slate-400">还没有引用术语，从上方下拉框选择总表条目。</div>
                  )}
                </div>
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <h2 class="font-bold">审校意见与回复</h2>
                <div class="mt-3 flex gap-2">
                  <textarea class="textarea textarea-bordered min-h-20 flex-1" placeholder="记录措辞、文化适配或法规依据…" value={commentDraft.value} onInput$={(_, element) => commentDraft.value = element.value} />
                  <button class="btn btn-primary self-end" onClick$={addComment}>添加意见</button>
                </div>
                <div class="mt-4 space-y-3">
                  {active().comments.length === 0 && <div class="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">还没有审校意见。</div>}
                  {active().comments.map((comment: ReviewComment) => (
                    <article key={comment.id} class={`rounded-xl border-l-4 bg-slate-50 p-3 ${comment.resolved ? "border-success opacity-60" : "border-warning"}`}>
                      <div class="flex items-center justify-between text-xs"><strong>{comment.author}</strong><span class="text-slate-400">{new Date(comment.createdAt).toLocaleString()}</span></div>
                      <p class="my-2 text-sm">{comment.body}</p>
                      {comment.replies.map((reply: Reply) => (
                        <div key={reply.id} class="ml-4 my-1 border-l-2 border-slate-200 pl-3 text-xs"><strong>{reply.author}</strong>：{reply.body}</div>
                      ))}
                      {replyingTo.value === comment.id ? (
                        <div class="mt-2 flex gap-2">
                          <input class="input input-xs input-bordered flex-1" value={replyDraft.value} onInput$={(_, element) => replyDraft.value = element.value} />
                          <button class="btn btn-xs btn-primary" onClick$={() => addReply(comment.id)}>发送</button>
                        </div>
                      ) : (
                        <div class="mt-2 flex gap-2">
                          <button class="btn btn-xs btn-ghost" onClick$={() => { replyingTo.value = comment.id; }}>回复</button>
                          <button class="btn btn-xs btn-ghost" onClick$={() => updateActive("更新意见状态", (sign) => { const entry = sign.comments.find((c: ReviewComment) => c.id === comment.id); if (entry) entry.resolved = !entry.resolved; })}>{comment.resolved ? "重新打开" : "标记已解决"}</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>

        <aside class="overflow-y-auto bg-slate-50 p-4">
          <section class="sticky top-4 space-y-4">
            <div class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Live Preview</div><h2 class="font-bold">版面实时预览</h2></div>
                  <span class={`badge ${preview().risk === "high" ? "badge-error" : preview().risk === "medium" ? "badge-warning" : "badge-success"}`}>
                    {preview().risk === "high" ? "溢出风险" : preview().risk === "medium" ? "接近边界" : "版面安全"}
                  </span>
                </div>
                <div class="mt-3 flex gap-1">
                  {WIDTHS.map((width) => <button key={width} class={`btn btn-xs flex-1 ${previewWidth.value === width ? "btn-primary" : "btn-outline"}`} onClick$={() => previewWidth.value = width}>{width}px</button>)}
                </div>
                <div class="mt-2 flex items-center gap-3 text-xs">
                  <span class="w-20">字号 {previewFont.value}px</span>
                  <input type="range" min="28" max="88" step="2" class="range range-primary range-xs flex-1" value={previewFont.value} onInput$={(_, element) => previewFont.value = Number(element.value)} />
                </div>
                <div class="mt-4 overflow-hidden rounded-xl bg-slate-800 p-3">
                  <div class="mx-auto grid min-h-48 place-items-center overflow-hidden border-4 border-white bg-[#174f3d] p-3 text-center text-white" style={{ width: `${previewWidth.value}px`, maxWidth: "100%" }}>
                    <div>
                      <div style={{ fontSize: `${previewFont.value}px` }} class="font-black leading-[1.18] tracking-wide">{preview().visible.map((line: string, index: number) => <div key={index}>{line || " "}</div>)}</div>
                    </div>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div class="rounded-lg bg-slate-100 p-2"><strong class="block text-lg">{preview().lines.length}</strong><span>预计行数</span></div>
                  <div class="rounded-lg bg-slate-100 p-2"><strong class="block text-lg">{active().targetText.length}</strong><span>字符数</span></div>
                  <div class="rounded-lg bg-slate-100 p-2"><strong class={`block text-lg ${preview().missingTerms.length ? "text-error" : "text-success"}`}>{preview().missingTerms.length}</strong><span>缺失术语</span></div>
                </div>
                {(preview().overflow || preview().tooLong) && <div class="alert alert-error mt-3 py-2 text-xs">{preview().overflow ? "当前字号下内容超过三行，可能截断。" : "译文接近标识建议字符上限。"}</div>}
              </div>
            </div>

            <div class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <div><h2 class="font-bold">版本比较</h2><p class="text-xs text-slate-500">旧版快照与当前译文逐词对比；快照内术语保存当时总表译法。</p></div>
                  <span class="badge badge-outline">{active().versions.length} 版</span>
                </div>
                {active().versions.length ? (
                  <>
                    <select class="select select-sm select-bordered mt-3 w-full" value={selectedVersionId.value || active().versions[0].id} onChange$={(_, element) => selectedVersionId.value = element.value}>
                      {active().versions.map((version: VersionSnapshot) => <option key={version.id} value={version.id}>{`${version.label} · ${new Date(version.createdAt).toLocaleTimeString()}`}</option>)}
                    </select>
                    <VersionDiff oldText={selectedVersion()!.targetText} newText={active().targetText} />
                    <div class="mt-2 flex gap-3 text-[11px]"><span class="text-green-700">绿：新增</span><span class="text-red-700">红：删除</span></div>
                  </>
                ) : (
                  <div class="mt-3 rounded-xl border border-dashed p-5 text-center text-xs text-slate-400">保存当前译文后会在这里生成可比较版本。</div>
                )}
              </div>
            </div>

            <div class="rounded-xl bg-[#17324d] p-4 text-xs text-slate-200">
              <div class="mb-2 font-bold text-white">键盘操作</div>
              <div class="grid grid-cols-2 gap-y-1"><span><kbd class="kbd kbd-xs">J/K</kbd> 切换标识</span><span><kbd class="kbd kbd-xs">[ ]</kbd> 预览宽度</span><span><kbd class="kbd kbd-xs">- =</kbd> 字号</span><span><kbd class="kbd kbd-xs">Ctrl/⌘ Z</kbd> 撤销</span></div>
            </div>
          </section>
        </aside>
      </div>

      {adminOpen.value && (
        <AdminPanel
          book={book}
          degraded={degraded.value}
          sourceLabel={SOURCE_LABELS[glossarySource.value]}
          newSource={adminNewSource.value}
          newLang={adminNewLang.value}
          newTarget={adminNewTarget.value}
          onClose$={$(() => { adminOpen.value = false; })}
          onSourceInput$={$((_: unknown, el: HTMLInputElement) => { adminNewSource.value = el.value; })}
          onLangChange$={$((_: unknown, el: HTMLSelectElement) => { adminNewLang.value = el.value; })}
          onTargetInput$={$((_: unknown, el: HTMLInputElement) => { adminNewTarget.value = el.value; })}
          onAdd$={adminAddConcept}
          onSaveTarget$={adminSaveTarget}
          onToggleActive$={adminToggleActive}
        />
      )}

      {toast.value && <div class="toast toast-end z-50" onClick$={() => { toast.value = ""; }}><div class="alert alert-success"><span>{toast.value}</span></div></div>}
    </div>
  );
});

interface AdminPanelProps {
  book: GlossaryBook;
  degraded: boolean;
  sourceLabel: string;
  newSource: string;
  newLang: string;
  newTarget: string;
  onClose$: QRL<() => void>;
  onSourceInput$: QRL<(_: unknown, el: HTMLInputElement) => void>;
  onLangChange$: QRL<(_: unknown, el: HTMLSelectElement) => void>;
  onTargetInput$: QRL<(_: unknown, el: HTMLInputElement) => void>;
  onAdd$: QRL<() => void>;
  onSaveTarget$: QRL<(conceptId: string, language: string, el: HTMLInputElement) => void>;
  onToggleActive$: QRL<(conceptId: string, language: string) => void>;
}

const VersionDiff = component$((props: { oldText: string; newText: string }) => {
  const tokens = diffText(props.oldText, props.newText);
  return (
    <div class="mt-3 rounded-lg bg-slate-900 p-3 text-sm leading-7 text-slate-100">
      {tokens.map((token, index) => (
        <span key={index} class={token.type === "add" ? "rounded bg-green-400/25 text-green-200" : token.type === "remove" ? "bg-red-400/25 text-red-200 line-through" : ""}>{token.value}</span>
      ))}
    </div>
  );
});

const AdminPanel = component$((props: AdminPanelProps) => {
  return (
    <div class="modal modal-open z-50">
      <div class="modal-box max-w-3xl">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-lg font-bold">机构术语总表（管理员）</h3>
            <p class="text-xs text-slate-500">
              按语种统一译法。改译或停用后发布：引用的标识不改写译文，只标待重新确认；两边都动过时以总表为准，冲突记录留在校对台意见与备注中。
            </p>
            <p class="mt-1 text-[11px] text-slate-400">总表 revision {props.book.revision} · 当前读取：{props.sourceLabel}{props.degraded ? "（故障中，修改会写入但其他校对台要等恢复后才能读到）" : ""}</p>
          </div>
          <button class="btn btn-sm btn-circle btn-ghost" onClick$={props.onClose$}>✕</button>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 p-3">
          <div class="mb-2 text-xs font-bold text-slate-500">新增术语条目（源语 + 语种译法）</div>
          <div class="grid grid-cols-[1fr_140px_1fr_auto] gap-2">
            <input class="input input-sm input-bordered" placeholder="中文术语" value={props.newSource} onInput$={props.onSourceInput$} />
            <select class="select select-sm select-bordered" value={props.newLang} onChange$={props.onLangChange$}>
              {LANGUAGES.map((language: string) => <option key={language}>{language}</option>)}
            </select>
            <input class="input input-sm input-bordered" placeholder="该语种标准译法" value={props.newTarget} onInput$={props.onTargetInput$} />
            <button class="btn btn-sm btn-primary" onClick$={props.onAdd$}>新增</button>
          </div>
        </div>

        <div class="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {props.book.concepts.map((concept: GlossaryConcept) => (
            <div key={concept.id} class="rounded-xl border border-slate-200 p-3">
              <div class="flex items-center justify-between">
                <strong class="text-sm">{concept.source}</strong>
                <span class="text-[10px] text-slate-400">{concept.id}</span>
              </div>
              <div class="mt-2 space-y-1">
                {LANGUAGES.map((language) => {
                  const tr = concept.translations[language];
                  if (!tr) return null;
                  return (
                    <div key={language} class="grid grid-cols-[86px_1fr_auto_auto] items-center gap-2">
                      <span class="text-xs text-slate-500">{language}</span>
                      <input
                        key={`${concept.id}-${language}-${tr.revision}`}
                        class="input input-xs input-bordered"
                        defaultValue={tr.target}
                        disabled={!tr.active}
                      />
                      <div class="flex gap-1">
                        <button
                          class="btn btn-xs btn-outline"
                          onClick$={(_, el) => {
                            const input = el.parentElement?.parentElement?.querySelector("input");
                            if (input) void props.onSaveTarget$(concept.id, language, input);
                          }}
                        >
                          改译发布
                        </button>
                        <button
                          class={`btn btn-xs ${tr.active ? "btn-warning" : "btn-success"}`}
                          onClick$={() => props.onToggleActive$(concept.id, language)}
                        >
                          {tr.active ? "停用" : "启用"}
                        </button>
                      </div>
                      <span class={`badge badge-xs ${tr.active ? "badge-ghost" : "badge-error"}`}>rev {tr.revision}{tr.active ? "" : " · 停用"}</span>
                    </div>
                  );
                })}
                {Object.keys(concept.translations).length === 0 && <div class="text-[11px] text-slate-400">暂无译法</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div class="modal-backdrop" onClick$={props.onClose$}></div>
    </div>
  );
});
