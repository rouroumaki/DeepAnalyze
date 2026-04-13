// =============================================================================
// DeepAnalyze - CronScheduler
// Simple polling-based cron scheduler
// =============================================================================

import { CronService } from "./service.js";

export class CronScheduler {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeJobs = new Set<string>();
  private service = new CronService();
  private maxConcurrent = 3;
  private jobTimeout = 300_000; // 5 minutes

  /** Start the scheduler — checks every 60 seconds */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[CronScheduler] Starting (60s interval)");

    // Check immediately
    this.tick();

    // Then every 60 seconds
    this.timer = setInterval(() => this.tick(), 60_000);
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log("[CronScheduler] Stopped");
  }

  /** Check for and execute due jobs */
  private async tick(): Promise<void> {
    try {
      const dueJobs = this.service.getDueJobs();
      if (dueJobs.length === 0) return;

      console.log(`[CronScheduler] ${dueJobs.length} job(s) due`);

      for (const job of dueJobs) {
        if (this.activeJobs.size >= this.maxConcurrent) {
          console.log("[CronScheduler] Max concurrent reached, skipping remaining");
          break;
        }
        if (this.activeJobs.has(job.id)) continue;

        this.executeJob(job.id, job.message);
      }
    } catch (err) {
      console.error("[CronScheduler] Tick error:", err);
    }
  }

  /** Execute a single job */
  async executeJob(jobId: string, message?: string): Promise<void> {
    if (this.activeJobs.has(jobId)) return;

    this.activeJobs.add(jobId);
    console.log(`[CronScheduler] Executing job ${jobId}`);

    try {
      // Get the job's message from the database
      const job = this.service.getJob(jobId);
      if (!job) {
        console.warn(`[CronScheduler] Job ${jobId} not found`);
        return;
      }

      const prompt = message ?? job.message;

      // Execute via the agent system's chat endpoint
      // We make an internal HTTP request to our own API
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.jobTimeout);

      try {
        // Create a session for this execution
        const baseUrl = process.env.CRON_BASE_URL || "http://localhost:21000";

        const sessionResp = await fetch(`${baseUrl}/api/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `[定时任务] ${job.name}` }),
          signal: controller.signal,
        });

        if (!sessionResp.ok) {
          throw new Error(`Failed to create session: ${sessionResp.status}`);
        }

        const session = await sessionResp.json() as { id: string };

        // Run the agent with the cron job's message
        const agentResp = await fetch(`${baseUrl}/api/agents/run-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.id,
            input: prompt,
            agentType: "general",
          }),
          signal: controller.signal,
        });

        if (!agentResp.ok) {
          const errText = await agentResp.text();
          throw new Error(`Agent execution failed: ${agentResp.status} ${errText}`);
        }

        // Consume the SSE stream (we don't need the output for now)
        const reader = agentResp.body?.getReader();
        if (reader) {
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          } finally {
            reader.releaseLock();
          }
        }

        this.service.markCompleted(jobId);
        console.log(`[CronScheduler] Job ${jobId} completed`);
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CronScheduler] Job ${jobId} failed:`, errorMsg);
      this.service.markFailed(jobId, errorMsg);
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  /** Check if a job is currently running */
  isJobActive(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }
}
