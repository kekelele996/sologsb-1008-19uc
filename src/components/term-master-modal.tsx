import { $, component$, useSignal } from "@builder.io/qwik";
import type { TermEntry, TermMaster } from "../types";
import { createTermEntry, removeEntry, setEntryStatus, upsertEntry } from "../utils";

interface TermMasterModalProps {
  master: TermMaster;
  onClose: () => void;
  onSave: (master: TermMaster) => void;
}

const LANGUAGES = ["English", "日本語", "Français", "Deutsch", "한국어", "Español"];

export const TermMasterModal = component$<TermMasterModalProps>(({ master, onClose, onSave }) => {
  const adding = useSignal(false);
  const editId = useSignal("");
  const formSource = useSignal("");
  const formLanguage = useSignal("English");
  const formTarget = useSignal("");
  const formNote = useSignal("");

  const startAdd = $(() => {
    formSource.value = "";
    formLanguage.value = "English";
    formTarget.value = "";
    formNote.value = "";
    adding.value = true;
    editId.value = "";
  });

  const startEdit = $((entry: TermEntry) => {
    editId.value = entry.id;
    formSource.value = entry.source;
    formLanguage.value = entry.language;
    formTarget.value = entry.target;
    formNote.value = entry.note;
    adding.value = false;
  });

  const cancelEdit = $(() => {
    adding.value = false;
    editId.value = "";
  });

  const saveAdd = $(() => {
    const source = formSource.value.trim();
    const target = formTarget.value.trim();
    if (!source || !target) return;
    const entry = createTermEntry(source, formLanguage.value, target, formNote.value.trim());
    onSave(upsertEntry(master, entry));
    adding.value = false;
  });

  const saveEdit = $(() => {
    const source = formSource.value.trim();
    const target = formTarget.value.trim();
    if (!source || !target) return;
    const existing = master.entries.find((item) => item.id === editId.value);
    if (!existing) return;
    onSave(upsertEntry(master, { ...existing, source, language: formLanguage.value, target, note: formNote.value.trim() }));
    editId.value = "";
  });

  const toggleStatus = $((entry: TermEntry) => {
    onSave(setEntryStatus(master, entry.id, entry.status === "active" ? "inactive" : "active"));
  });

  const deleteEntry = $((entryId: string) => {
    onSave(removeEntry(master, entryId));
  });

  const grouped = new Map<string, TermEntry[]>();
  for (const entry of master.entries) {
    const list = grouped.get(entry.language) ?? [];
    list.push(entry);
    grouped.set(entry.language, list);
  }

  return (
    <div class="modal modal-open">
      <div class="modal-box max-w-3xl">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-bold">术语总表</h3>
          <button class="btn btn-sm btn-ghost" onClick$={onClose}>✕</button>
        </div>
        <p class="mt-1 text-xs text-slate-500">管理员按语种定译法。校对台只引用条目，不直接改写译文。</p>

        <div class="mt-4 flex justify-end">
          <button class="btn btn-sm btn-primary" onClick$={startAdd}>+ 新增条目</button>
        </div>

        {adding.value && (
          <div class="mt-3 rounded-xl border border-slate-200 p-3">
            <div class="grid grid-cols-2 gap-2">
              <input class="input input-sm input-bordered" placeholder="中文术语" value={formSource.value} onInput$={(_, el) => formSource.value = el.value} />
              <select class="select select-sm select-bordered" value={formLanguage.value} onChange$={(_, el) => formLanguage.value = el.value}>
                {LANGUAGES.map((lang) => <option key={lang}>{lang}</option>)}
              </select>
              <input class="input input-sm input-bordered" placeholder="固定译法" value={formTarget.value} onInput$={(_, el) => formTarget.value = el.value} />
              <input class="input input-sm input-bordered" placeholder="备注" value={formNote.value} onInput$={(_, el) => formNote.value = el.value} />
            </div>
            <div class="mt-2 flex justify-end gap-2">
              <button class="btn btn-xs btn-ghost" onClick$={cancelEdit}>取消</button>
              <button class="btn btn-xs btn-primary" onClick$={saveAdd}>保存</button>
            </div>
          </div>
        )}

        <div class="mt-4 space-y-4">
          {[...grouped.entries()].map(([language, entries]) => (
            <div key={language}>
              <div class="text-xs font-bold uppercase tracking-wider text-slate-400">{language}</div>
              <div class="mt-2 space-y-2">
                {entries.map((entry) => (
                  <div key={entry.id} class="rounded-lg border border-slate-200 p-3">
                    {editId.value === entry.id ? (
                      <div class="grid grid-cols-2 gap-2">
                        <input class="input input-sm input-bordered" value={formSource.value} onInput$={(_, el) => formSource.value = el.value} />
                        <select class="select select-sm select-bordered" value={formLanguage.value} onChange$={(_, el) => formLanguage.value = el.value}>
                          {LANGUAGES.map((lang) => <option key={lang}>{lang}</option>)}
                        </select>
                        <input class="input input-sm input-bordered" value={formTarget.value} onInput$={(_, el) => formTarget.value = el.value} />
                        <input class="input input-sm input-bordered" placeholder="备注" value={formNote.value} onInput$={(_, el) => formNote.value = el.value} />
                        <div class="col-span-2 flex justify-end gap-2">
                          <button class="btn btn-xs btn-ghost" onClick$={cancelEdit}>取消</button>
                          <button class="btn btn-xs btn-primary" onClick$={saveEdit}>保存</button>
                        </div>
                      </div>
                    ) : (
                      <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                          <div class="truncate text-sm font-bold">{entry.source} → {entry.target}</div>
                          {entry.note && <div class="truncate text-xs text-slate-500">{entry.note}</div>}
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <span class={`badge badge-sm ${entry.status === "active" ? "badge-success" : "badge-neutral"}`}>
                            {entry.status === "active" ? "启用" : "停用"}
                          </span>
                          <button class="btn btn-xs btn-ghost" onClick$={() => startEdit(entry)}>编辑</button>
                          <button class="btn btn-xs btn-ghost" onClick$={() => toggleStatus(entry)}>
                            {entry.status === "active" ? "停用" : "启用"}
                          </button>
                          <button class="btn btn-xs btn-ghost text-error" onClick$={() => deleteEntry(entry.id)}>删除</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {master.entries.length === 0 && (
            <div class="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">术语总表还没有条目，点击「+ 新增条目」添加。</div>
          )}
        </div>
      </div>
      <div class="modal-backdrop" onClick$={onClose}></div>
    </div>
  );
});
