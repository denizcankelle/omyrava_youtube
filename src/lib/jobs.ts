import { randomUUID } from "node:crypto";
import { type DB, nowIso } from "./db";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  project_id: string | null;
  type: string;
  status: JobStatus;
  payload: string;
  result: string | null;
  step: string | null;
  progress: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobLog {
  id: number;
  job_id: string;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
}

/** Hata tipi: retry edilmemesi gereken hatalar icin retryable=false. */
export class JobError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = true,
  ) {
    super(message);
    this.name = "JobError";
  }
}

/** Ustel bekleme: 5s, 10s, 20s ... en fazla 5 dk. */
export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 300_000);
}

export function enqueueJob(
  db: DB,
  input: { type: string; projectId?: string | null; payload?: unknown; maxAttempts?: number },
): Job {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO jobs (id, project_id, type, payload, max_attempts) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId ?? null,
    input.type,
    JSON.stringify(input.payload ?? {}),
    input.maxAttempts ?? 3,
  );
  return getJob(db, id)!;
}

export function getJob(db: DB, id: string): Job | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function listJobs(db: DB, opts: { projectId?: string; limit?: number } = {}): Job[] {
  const limit = opts.limit ?? 50;
  if (opts.projectId) {
    return db
      .prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(opts.projectId, limit) as unknown as Job[];
  }
  return db
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as Job[];
}

export function getJobLogs(db: DB, jobId: string): JobLog[] {
  return db
    .prepare("SELECT * FROM job_logs WHERE job_id = ? ORDER BY id ASC")
    .all(jobId) as unknown as JobLog[];
}

export function logJob(db: DB, jobId: string, level: JobLog["level"], message: string) {
  db.prepare("INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)").run(
    jobId,
    level,
    message,
  );
}

/** Sirasi gelen bir isi atomik olarak alir (queued -> running). */
export function claimNextJob(db: DB, now = new Date()): Job | undefined {
  const ts = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ?
         ORDER BY run_after ASC, created_at ASC LIMIT 1`,
      )
      .get(ts) as { id: string } | undefined;
    if (!row) {
      db.exec("COMMIT");
      return undefined;
    }
    db.prepare(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = ?,
         updated_at = ?, error_code = NULL, error_message = NULL WHERE id = ?`,
    ).run(ts, ts, row.id);
    db.exec("COMMIT");
    return getJob(db, row.id);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Ilerleme kapsami: bir is baska islerin adimlarini kendi icinde calistirirken (otomatik akis),
 * alt adimin 0..1 ilerlemesini ust isin [from, to] araligina esler ve adim adina etiket ekler.
 */
const progressScopes = new Map<string, { from: number; to: number; label: string }>();

export function setProgressScope(
  jobId: string,
  scope: { from: number; to: number; label: string } | null,
) {
  if (scope) progressScopes.set(jobId, scope);
  else progressScopes.delete(jobId);
}

export function updateProgress(db: DB, jobId: string, progress: number, step?: string) {
  const scope = progressScopes.get(jobId);
  let p = Math.max(0, Math.min(1, progress));
  let label = step;
  if (scope) {
    p = scope.from + p * (scope.to - scope.from);
    label = step ? `${scope.label} · ${step}` : scope.label;
  }
  if (label !== undefined) {
    db.prepare("UPDATE jobs SET progress = ?, step = ?, updated_at = ? WHERE id = ?").run(
      p,
      label,
      nowIso(),
      jobId,
    );
  } else {
    db.prepare("UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?").run(p, nowIso(), jobId);
  }
}

export function completeJob(db: DB, jobId: string, result: unknown) {
  db.prepare(
    `UPDATE jobs SET status = 'succeeded', progress = 1, result = ?, locked_at = NULL,
       updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(result ?? null), nowIso(), jobId);
}

/** Hata: deneme hakki varsa geri bekleme ile tekrar kuyruga alir, yoksa 'failed'. */
export function failJob(db: DB, job: Job, err: unknown, now = new Date()): "retry" | "failed" {
  const code = err instanceof JobError ? err.code : "UNEXPECTED";
  const message = err instanceof Error ? err.message : String(err);
  const retryable = err instanceof JobError ? err.retryable : true;
  const ts = now.toISOString();
  if (retryable && job.attempts < job.max_attempts) {
    const runAfter = new Date(now.getTime() + backoffMs(job.attempts)).toISOString();
    db.prepare(
      `UPDATE jobs SET status = 'queued', run_after = ?, locked_at = NULL, error_code = ?,
         error_message = ?, updated_at = ? WHERE id = ?`,
    ).run(runAfter, code, message, ts, job.id);
    logJob(db, job.id, "warn", `Deneme ${job.attempts} basarisiz (${code}): ${message}`);
    return "retry";
  }
  db.prepare(
    `UPDATE jobs SET status = 'failed', locked_at = NULL, error_code = ?, error_message = ?,
       updated_at = ? WHERE id = ?`,
  ).run(code, message, ts, job.id);
  logJob(db, job.id, "error", `Is basarisiz (${code}): ${message}`);
  return "failed";
}

export function cancelJob(db: DB, jobId: string): boolean {
  const res = db
    .prepare(
      `UPDATE jobs SET status = 'cancelled', locked_at = NULL, updated_at = ?
       WHERE id = ? AND status IN ('queued','running')`,
    )
    .run(nowIso(), jobId);
  return Number(res.changes) > 0;
}

export function isCancelled(db: DB, jobId: string): boolean {
  return getJob(db, jobId)?.status === "cancelled";
}

/** Worker cokup kalmis 'running' isleri tekrar kuyruga alir. */
export function recoverStaleJobs(db: DB, staleAfterMs: number, now = new Date()): number {
  const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
  const res = db
    .prepare(
      `UPDATE jobs SET status = 'queued', locked_at = NULL, updated_at = ?
       WHERE status = 'running' AND (locked_at IS NULL OR locked_at < ?)`,
    )
    .run(now.toISOString(), cutoff);
  return Number(res.changes);
}
