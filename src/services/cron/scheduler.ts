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
      const dueJobs = await this.service.getDueJobs();
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
      const job = await this.service.getJob(jobId);
      if (!job) {
        console.warn(`[CronScheduler] Job ${jobId} not found`);
        return;
      }

      // If this is a system action, execute it directly
      if (job.action) {
        await this.executeAction(jobId, job.action);
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

  /** Execute a system-level action */
  private async executeAction(jobId: string, action: string): Promise<void> {
    console.log(`[CronScheduler] Executing system action: ${action}`);

    try {
      switch (action) {
        case "reindex": {
          // Trigger reindex for all knowledge bases with stale embeddings
          const { getRepos } = await import("../../store/repos/index.js");
          const repos = await getRepos();
          const { getProcessingQueue } = await import("../processing-queue.js");
          const queue = getProcessingQueue();

          const kbs = await repos.knowledgeBase.list();
          let reindexed = 0;
          for (const kb of kbs) {
            const docs = await repos.document.getByKbId(kb.id);
            for (const doc of docs) {
              if (doc.status === "error" || doc.status === "needs_reindex") {
                queue.enqueue({
                  kbId: kb.id,
                  docId: doc.id,
                  filename: doc.filename,
                  filePath: doc.file_path,
                  fileType: doc.file_type,
                });
                reindexed++;
              }
            }
          }
          console.log(`[CronScheduler] Reindex queued ${reindexed} documents`);
          this.service.markCompleted(jobId);
          break;
        }

        case "cleanup": {
          // Clean up old sessions, temp files, etc.
          const { getRepos } = await import("../../store/repos/index.js");
          const repos = await getRepos();
          const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
          // Clean up old error documents
          const kbs = await repos.knowledgeBase.list();
          let cleaned = 0;
          for (const kb of kbs) {
            const docs = await repos.document.getByKbId(kb.id);
            for (const doc of docs) {
              if (doc.status === "error" && new Date(doc.created_at) < cutoff) {
                await repos.document.deleteById(doc.id);
                cleaned++;
              }
            }
          }
          console.log(`[CronScheduler] Cleanup removed ${cleaned} old error documents`);
          this.service.markCompleted(jobId);
          break;
        }

        case "health_check": {
          const baseUrl = process.env.CRON_BASE_URL || "http://localhost:21000";
          const resp = await fetch(`${baseUrl}/api/health`);
          if (!resp.ok) throw new Error(`Health check failed: ${resp.status}`);
          const data = await resp.json() as { status: string };
          console.log(`[CronScheduler] Health check: ${data.status}`);
          this.service.markCompleted(jobId);
          break;
        }

        default:
          throw new Error(`Unknown system action: ${action}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CronScheduler] Action ${action} failed:`, errorMsg);
      this.service.markFailed(jobId, errorMsg);
    }
  }
}
