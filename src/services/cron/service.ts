// =============================================================================
// DeepAnalyze - CronService
// CRUD operations and scheduling logic for cron jobs
// =============================================================================

import { randomUUID } from "node:crypto";
import { DB } from "../../store/database.js";
import {
  type CronJob,
  type CreateCronJobRequest,
  type UpdateCronJobRequest,
  type CronJobRow,
  rowToJob,
} from "./types.js";

export class CronService {
  private get db() {
    return DB.getInstance().raw;
  }

  /** Validate a 5-part cron expression */
  validateSchedule(schedule: string): boolean {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    // Basic validation: each part should match cron patterns
    const partPatterns = [
      /^(\*|[0-5]?\d|([0-5]?\d-[0-5]?\d)(,[0-5]?\d(-[0-5]?\d)?)*|([*]\/[0-5]?\d))$/,  // minute
      /^(\*|[01]?\d|2[0-3]|([01]?\d-[01]?\d)(,[01]?\d(-[01]?\d)?)*|([*]\/[01]?\d))$/,     // hour
      /^(\*|[0-2]?\d|3[01]|([0-2]?\d-[0-2]?\d)(,[0-2]?\d(-[0-2]?\d)?)*|([*]\/[0-2]?\d))$/, // day
      /^(\*|[0]?[1-9]|1[0-2]|([0]?[1-9]-[0]?[1-9])(,[0]?[1-9](-[0]?[1-9])?)*)$/,           // month
      /^(\*|[0-6]|([0-6]-[0-6])(,[0-6](-[0-6])?)*)$/,                                        // weekday
    ];
    return parts.every((part, i) => {
      // Also allow */N patterns for all fields
      if (/^\*\/\d+$/.test(part)) return true;
      // Also allow simple numbers
      if (/^\d+$/.test(part)) return true;
      return partPatterns[i].test(part);
    });
  }

  /** Calculate next run time from a cron expression */
  calculateNextRun(schedule: string): string {
    const now = new Date();
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) return now.toISOString();

    // Simple next-run calculation: find the next matching time
    // by checking each minute for the next 366 days
    const test = new Date(now.getTime());
    test.setSeconds(0, 0);
    // Start from the next minute
    test.setMinutes(test.getMinutes() + 1);

    const maxIterations = 525960; // 366 days in minutes
    for (let i = 0; i < maxIterations; i++) {
      const minute = test.getMinutes();
      const hour = test.getHours();
      const day = test.getDate();
      const month = test.getMonth() + 1;
      const weekday = test.getDay();

      if (
        this.matchesPart(parts[0], minute, 0, 59) &&
        this.matchesPart(parts[1], hour, 0, 23) &&
        this.matchesPart(parts[2], day, 1, 31) &&
        this.matchesPart(parts[3], month, 1, 12) &&
        this.matchesPart(parts[4], weekday, 0, 6)
      ) {
        return test.toISOString();
      }
      test.setMinutes(test.getMinutes() + 1);
    }

    // Fallback: 1 year from now
    return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  }

  private matchesPart(part: string, value: number, min: number, max: number): boolean {
    if (part === "*") return true;
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      return step > 0 && value % step === 0;
    }
    if (part.includes(",")) {
      return part.split(",").some((p) => this.matchesPart(p, value, min, max));
    }
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return value >= start && value <= end;
    }
    return parseInt(part) === value;
  }

  /** Generate a human-readable description of a cron schedule */
  describeSchedule(schedule: string): string {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) return schedule;

    const [minute, hour, day, month, weekday] = parts;

    if (minute.startsWith("*/")) {
      const n = minute.slice(2);
      return `每 ${n} 分钟`;
    }
    if (hour === "*" && minute !== "*" && !minute.startsWith("*/")) {
      return `每小时第 ${minute} 分钟`;
    }
    if (weekday !== "*" && hour !== "*" && minute !== "*") {
      const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      return `${days[parseInt(weekday)] ?? "周" + weekday} ${hour}:${minute.padStart(2, "0")}`;
    }
    if (day !== "*" && day !== "*/1" && hour !== "*" && minute !== "*") {
      return `每月 ${day} 日 ${hour}:${minute.padStart(2, "0")}`;
    }
    if (hour !== "*" && minute !== "*") {
      return `每天 ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    }
    return schedule;
  }

  // --- CRUD ---

  createJob(data: CreateCronJobRequest): CronJob {
    if (!this.validateSchedule(data.schedule)) {
      throw new Error("无效的 cron 表达式");
    }

    const id = `cron_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const nextRun = this.calculateNextRun(data.schedule);

    this.db.prepare(`
      INSERT INTO cron_jobs (id, name, schedule, message, enabled, channel, chat_id, deliver_response, next_run, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name,
      data.schedule,
      data.message,
      (data.enabled ?? true) ? 1 : 0,
      data.channel ?? null,
      data.chatId ?? null,
      (data.deliverResponse ?? false) ? 1 : 0,
      nextRun,
      now,
      now,
    );

    return this.getJob(id)!;
  }

  getJob(id: string): CronJob | null {
    const row = this.db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as CronJobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  listJobs(): CronJob[] {
    const rows = this.db.prepare("SELECT * FROM cron_jobs ORDER BY created_at DESC").all() as CronJobRow[];
    return rows.map(rowToJob);
  }

  updateJob(id: string, data: UpdateCronJobRequest): CronJob | null {
    const existing = this.getJob(id);
    if (!existing) return null;

    if (data.schedule && !this.validateSchedule(data.schedule)) {
      throw new Error("无效的 cron 表达式");
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    const fields: Record<string, unknown> = {
      name: data.name,
      schedule: data.schedule,
      message: data.message,
      enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : undefined,
      channel: data.channel,
      chat_id: data.chatId,
      deliver_response: data.deliverResponse !== undefined ? (data.deliverResponse ? 1 : 0) : undefined,
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return existing;

    // Recalculate next_run if schedule changed
    if (data.schedule) {
      const nextRun = this.calculateNextRun(data.schedule);
      updates.push("next_run = ?");
      values.push(nextRun);
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    this.db.prepare(`UPDATE cron_jobs SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    return this.getJob(id);
  }

  deleteJob(id: string): boolean {
    const result = this.db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Get jobs that are due to run (next_run <= now AND enabled) */
  getDueJobs(): CronJob[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(
      "SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run <= ?"
    ).all(now) as CronJobRow[];
    return rows.map(rowToJob);
  }

  /** Mark a job as completed */
  markCompleted(id: string): void {
    const job = this.getJob(id);
    if (!job) return;
    const nextRun = this.calculateNextRun(job.schedule);
    this.db.prepare(`
      UPDATE cron_jobs
      SET last_run = datetime('now'),
          last_status = 'success',
          last_error = NULL,
          run_count = run_count + 1,
          next_run = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(nextRun, id);
  }

  /** Mark a job as failed */
  markFailed(id: string, error: string): void {
    const job = this.getJob(id);
    if (!job) return;
    const nextRun = this.calculateNextRun(job.schedule);
    this.db.prepare(`
      UPDATE cron_jobs
      SET last_run = datetime('now'),
          last_status = 'failed',
          last_error = ?,
          run_count = run_count + 1,
          error_count = error_count + 1,
          next_run = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(error, nextRun, id);
  }
}
