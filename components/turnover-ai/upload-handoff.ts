// Carries the files a staff member drops on the Turnover AI Projects list to
// the project page that reads them. Vincent, 2026-10-05: "先把文件拉到上传板块
// 后，系统就跳出那个弹窗，然后直接把需要计算的文件计入在这个新开的文件夹中" —
// drop first, name the project in the pop-up, and the files go straight in.
//
// The project is created BEFORE any file is read: the extract route reads
// the project's gst_enabled for every file, and GST can't be changed after
// creation. The reading itself stays in the project page's one upload loop
// (progress, errors, live total) — this module only holds the File objects
// across the client-side navigation, in memory: they never touch
// sessionStorage (strings only) or disk (receipts are sensitive).
//
// Take-once: React StrictMode runs effects twice in development, and a
// second read would upload every file twice. A full page reload between the
// two pages (Next does one after a deploy changes the build) empties this
// module — the project page's `?incoming=N` marker then says so instead of
// silently showing an empty project.

export const ACCEPTED_TYPES: readonly string[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const ACCEPT = ACCEPTED_TYPES.join(',');
export const MAX_FILES_PER_BATCH = 100;
export const INCOMING_PARAM = 'incoming';

export type PreparedBatch = { batch: File[]; deferred: File[]; rejected: File[] };

/** Same type rule as the extract route; the first 100 readable files by name are this round, the rest wait for the next. */
export function prepareBatch(files: Iterable<File>): PreparedBatch {
  const all = Array.from(files);
  const readable = all.filter(f => ACCEPTED_TYPES.includes(f.type))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return {
    batch: readable.slice(0, MAX_FILES_PER_BATCH),
    deferred: readable.slice(MAX_FILES_PER_BATCH),
    rejected: all.filter(f => !ACCEPTED_TYPES.includes(f.type)),
  };
}

const staged = new Map<number, File[]>();

export function stageFiles(projectId: number, files: File[]): void {
  staged.set(projectId, files);
}

export function takeStagedFiles(projectId: number): File[] | null {
  const files = staged.get(projectId) ?? null;
  staged.delete(projectId);
  return files;
}
