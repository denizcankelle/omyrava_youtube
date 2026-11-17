import { describe, expect, it } from "vitest";
import {
  JobError,
  backoffMs,
  cancelJob,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  getJob,
  getJobLogs,
  recoverStaleJobs,
} from "../src/lib/jobs";
import { memoryDb } from "./helpers";

describe("is kuyrugu", () => {
  it("is ekler, alir ve tamamlar", () => {
    const db = memoryDb();
    const job = enqueueJob(db, { type: "t", payload: { a: 1 } });
    expect(job.status).toBe("queued");
    const claimed = claimNextJob(db)!;
    expect(claimed.id).toBe(job.id);
    expect(claimed.status).toBe("running");
    expect(claimed.attempts).toBe(1);
    expect(claimNextJob(db)).toBeUndefined();
    completeJob(db, job.id, { ok: true });
    const done = getJob(db, job.id)!;
    expect(done.status).toBe("succeeded");
    expect(done.progress).toBe(1);
    expect(JSON.parse(done.result!)).toEqual({ ok: true });
  });

  it("hata sonrasi bekleme ile tekrar dener, hak bitince failed olur", () => {
    const db = memoryDb();
    enqueueJob(db, { type: "t", maxAttempts: 2 });
    const t0 = new Date(Date.now() + 1000);
    const j1 = claimNextJob(db, t0)!;
    expect(failJob(db, j1, new Error("x"), t0)).toBe("retry");
    // bekleme suresi dolmadan alinmaz
    expect(claimNextJob(db, new Date(t0.getTime() + 1000))).toBeUndefined();
    const j2 = claimNextJob(db, new Date(t0.getTime() + backoffMs(1) + 1))!;
    expect(j2.attempts).toBe(2);
    expect(failJob(db, j2, new Error("y"))).toBe("failed");
    const final = getJob(db, j2.id)!;
    expect(final.status).toBe("failed");
    expect(final.error_message).toBe("y");
    expect(getJobLogs(db, j2.id).length).toBe(2);
  });

  it("tekrar edilemez hata hemen failed olur", () => {
    const db = memoryDb();
    enqueueJob(db, { type: "t", maxAttempts: 5 });
    const j = claimNextJob(db)!;
    expect(failJob(db, j, new JobError("BAD", "kalici", false))).toBe("failed");
    expect(getJob(db, j.id)!.error_code).toBe("BAD");
  });

  it("iptal edilen is alinmaz", () => {
    const db = memoryDb();
    const j = enqueueJob(db, { type: "t" });
    expect(cancelJob(db, j.id)).toBe(true);
    expect(claimNextJob(db)).toBeUndefined();
    expect(cancelJob(db, j.id)).toBe(false);
  });

  it("yarim kalan isler kurtarilir", () => {
    const db = memoryDb();
    const j = enqueueJob(db, { type: "t" });
    claimNextJob(db);
    expect(recoverStaleJobs(db, 0, new Date(Date.now() + 1000))).toBe(1);
    expect(getJob(db, j.id)!.status).toBe("queued");
  });

  it("bekleme suresi ustel artar ve sinirlidir", () => {
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(2)).toBe(10000);
    expect(backoffMs(20)).toBe(300000);
  });
});
