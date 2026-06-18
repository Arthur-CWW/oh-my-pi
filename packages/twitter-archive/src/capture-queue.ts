import { randomUUID } from "node:crypto";
import type { CaptureJob, CaptureTarget, CaptureProvenance } from "./capture-types";
import { checkCaptureTargetPolicy } from "./capture-policy";

/**
 * State manager for the low-rate queue planner.
 * Enforces one-job-at-a-time concurrency defaults.
 */
export class CaptureQueuePlanner {
  private jobs: CaptureJob[] = [];
  private concurrencyLimit: number = 1; // One-job-at-a-time default

  constructor(options?: { concurrency?: number }) {
    if (options?.concurrency !== undefined) {
      this.concurrencyLimit = options.concurrency;
    }
  }

  public getJobs(): CaptureJob[] {
    return [...this.jobs];
  }

  /**
   * Adds a capture job to the queue after validating against the safety policy.
   */
  public addJob(target: CaptureTarget, options?: { priority?: number }): CaptureJob {
    const policy = checkCaptureTargetPolicy(target);
    if (!policy.allowed) {
      throw new Error(`Policy violation: ${policy.reason}`);
    }

    const job: CaptureJob = {
      id: randomUUID(),
      target,
      status: "pending",
      priority: options?.priority ?? 0,
      createdTime: Date.now(),
    };

    this.jobs.push(job);
    this.sortJobs();
    return job;
  }

  /**
   * Gets the next eligible pending job if concurrency limit allows.
   */
  public getNextJob(): CaptureJob | null {
    const activeCount = this.jobs.filter((j) => j.status === "processing").length;
    if (activeCount >= this.concurrencyLimit) {
      return null;
    }
    return this.jobs.find((j) => j.status === "pending") ?? null;
  }

  /**
   * Starts processing a job, enforcing the concurrency limit.
   */
  public startJob(jobId: string): CaptureJob {
    const index = this.jobs.findIndex((j) => j.id === jobId);
    const job = this.jobs[index];
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status !== "pending") {
      throw new Error(`Cannot start job in status: ${job.status}`);
    }

    const activeJobs = this.jobs.filter((j) => j.status === "processing");
    if (activeJobs.length >= this.concurrencyLimit) {
      throw new Error(
        `Concurrency limit of ${this.concurrencyLimit} reached. Active jobs: ${activeJobs.map((j) => j.id).join(", ")}`
      );
    }

    const updated: CaptureJob = { ...job, status: "processing", startedTime: Date.now() };
    this.jobs[index] = updated;
    return updated;
  }

  /**
   * Transitions job to completed state and logs source provenance.
   */
  public completeJob(jobId: string, provenance: CaptureProvenance): CaptureJob {
    const index = this.jobs.findIndex((j) => j.id === jobId);
    const job = this.jobs[index];
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updated: CaptureJob = { ...job, status: "completed", provenance, endedTime: Date.now() };
    this.jobs[index] = updated;
    return updated;
  }

  /**
   * Transitions job to failed state.
   */
  public failJob(jobId: string, errorMsg: string): CaptureJob {
    const index = this.jobs.findIndex((j) => j.id === jobId);
    const job = this.jobs[index];
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updated: CaptureJob = { ...job, status: "failed", error: errorMsg, endedTime: Date.now() };
    this.jobs[index] = updated;
    return updated;
  }

  /**
   * Transitions job to stopped/aborted state.
   */
  public stopJob(jobId: string, reason: string): CaptureJob {
    const index = this.jobs.findIndex((j) => j.id === jobId);
    const job = this.jobs[index];
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updated: CaptureJob = { ...job, status: "stopped", error: reason, endedTime: Date.now() };
    this.jobs[index] = updated;
    return updated;
  }

  public clear(): void {
    this.jobs = [];
  }

  private sortJobs(): void {
    this.jobs.sort((a, b) => {
      if (a.status === "pending" && b.status === "pending") {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.createdTime - b.createdTime;
      }
      return 0;
    });
  }
}
