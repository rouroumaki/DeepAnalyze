// =============================================================================
// DeepAnalyze - Background Document Processing Queue
// Processes uploaded documents through 4 sequential steps:
//   parsing -> compiling -> indexing -> linking
// =============================================================================

import { getRepos } from "../store/repos/index.js";
import { ProcessorFactory } from "./document-processors/processor-factory.js";
import { ModelRouter } from "../models/router.js";
import { WikiCompiler } from "../wiki/compiler.js";
import type { ParsedContent } from "./document-processors/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessingJob {
  kbId: string;
  docId: string;
  filename: string;
  filePath: string;
  fileType: string;
}

interface ActiveJob {
  job: ProcessingJob;
  abortController: AbortController;
}

// ---------------------------------------------------------------------------
// ProcessingQueue
// ---------------------------------------------------------------------------

export class ProcessingQueue {
  private queue: ProcessingJob[] = [];
  private active: Map<string, ActiveJob> = new Map();
  private concurrency: number;
  private processing: boolean = false;

  constructor(concurrency: number = 1) {
    this.concurrency = concurrency;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Add a job to the queue. Deduplicates by docId — if the same document
   * is already queued or actively processing, the duplicate is silently ignored.
   */
  enqueue(job: ProcessingJob): void {
    // Deduplicate: skip if already queued
    const alreadyQueued = this.queue.some((j) => j.docId === job.docId);
    if (alreadyQueued) {
      return;
    }

    // Deduplicate: skip if already actively processing
    if (this.active.has(job.docId)) {
      return;
    }

    this.queue.push(job);
    console.log(
      `[ProcessingQueue] Enqueued ${job.filename} (${job.docId}), queue depth=${this.queue.length}`,
    );
    this.processNext();
  }

  /**
   * Cancel a job. Removes it from the queue if pending, or aborts
   * the active job if it is currently being processed.
   */
  cancel(docId: string): void {
    // Remove from queue
    const queueIndex = this.queue.findIndex((j) => j.docId === docId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      console.log(`[ProcessingQueue] Cancelled queued job for ${docId}`);
      return;
    }

    // Abort active job
    const activeJob = this.active.get(docId);
    if (activeJob) {
      activeJob.abortController.abort();
      this.active.delete(docId);
      console.log(`[ProcessingQueue] Aborted active job for ${docId}`);

      // Update DB status
      this.updateDbStatus(docId, "error", null, 0, "Cancelled by user");

      // Broadcast cancellation
      this.broadcast(docId, "kb", {
        type: "doc_error",
        docId,
        error: "Cancelled by user",
      });
    }
  }

  /**
   * Update the concurrency limit. If increasing, triggers processNext
   * to potentially start more jobs.
   */
  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    console.log(`[ProcessingQueue] Concurrency set to ${this.concurrency}`);
    this.processNext();
  }

  // -----------------------------------------------------------------------
  // Queue processing
  // -----------------------------------------------------------------------

  /**
   * Process the next job in the queue if capacity allows.
   * If already at the concurrency limit or no jobs available, returns immediately.
   */
  private processNext(): void {
    if (this.processing) {
      return;
    }

    if (this.active.size >= this.concurrency) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift()!;
    const abortController = new AbortController();

    this.active.set(job.docId, { job, abortController });

    // Fire-and-forget: processJob runs asynchronously
    this.processJob(job, abortController)
      .catch((err) => {
        console.error(
          `[ProcessingQueue] Unhandled error processing ${job.docId}:`,
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => {
        this.active.delete(job.docId);

        // Mark that we are no longer in a synchronous processing gate,
        // then try to process the next job.
        this.processing = false;
        this.processNext();
      });

    // Set processing flag to prevent re-entrant synchronous calls
    this.processing = true;
  }

  // -----------------------------------------------------------------------
  // Job execution — 4 sequential steps
  // -----------------------------------------------------------------------

  private async processJob(
    job: ProcessingJob,
    abortController: AbortController,
  ): Promise<void> {
    const { kbId, docId, filename, filePath, fileType } = job;

    console.log(`[ProcessingQueue] Starting processing: ${filename} (${docId})`);

    try {
      // === Step 1: Parsing ===
      this.throwIfAborted(abortController, docId);
      await this.stepParsing(job, abortController);

      // === Step 2: Compiling ===
      this.throwIfAborted(abortController, docId);
      await this.stepCompiling(job, abortController);

      // === Step 3: Indexing (Phase A: no-op placeholder) ===
      this.throwIfAborted(abortController, docId);
      await this.stepIndexing(job, abortController);

      // === Step 4: Linking (Phase A: no-op placeholder) ===
      this.throwIfAborted(abortController, docId);
      await this.stepLinking(job, abortController);

      // === Complete ===
      this.throwIfAborted(abortController, docId);
      this.updateDbStatus(docId, "ready", null, 1.0);
      this.broadcast(kbId, "kb", {
        type: "doc_ready",
        kbId,
        docId,
        filename,
      });

      console.log(
        `[ProcessingQueue] Completed processing: ${filename} (${docId})`,
      );
    } catch (err) {
      // Check if this was an abort (cancellation) — if so, don't overwrite
      if (abortController.signal.aborted) {
        console.log(`[ProcessingQueue] Job aborted: ${filename} (${docId})`);
        return;
      }

      const message =
        err instanceof Error ? err.message : String(err);
      console.error(
        `[ProcessingQueue] Error processing ${filename} (${docId}): ${message}`,
      );

      this.updateDbStatus(docId, "error", null, 0, message);
      this.broadcast(kbId, "kb", {
        type: "doc_error",
        kbId,
        docId,
        filename,
        error: message,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Step 1: Parsing
  // -----------------------------------------------------------------------

  private async stepParsing(
    job: ProcessingJob,
    abortController: AbortController,
  ): Promise<void> {
    const { kbId, docId, filename, filePath, fileType } = job;

    // Update DB status
    this.updateDbStatus(docId, "parsing", "parsing", 0.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "parsing",
      step: "parsing",
      progress: 0.0,
    });

    // Parse the document using the same logic as knowledge.ts route
    const parsedContent = await this.parseDocument(job, abortController);

    // Store parsed content for subsequent steps
    (job as ProcessingJob & { _parsedContent: ParsedContent })._parsedContent = parsedContent;

    // Update progress
    this.updateDbStatus(docId, "parsing", "parsing", 1.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "parsing",
      step: "parsing",
      progress: 1.0,
    });
  }

  /**
   * Parse a document using the ProcessorFactory.
   * Routes to the correct processor based on file type.
   * Returns full ParsedContent including raw/doctags when available.
   */
  private async parseDocument(
    job: ProcessingJob,
    abortController: AbortController,
  ): Promise<ParsedContent> {
    const { filePath, fileType, filename } = job;

    const factory = ProcessorFactory.getInstance();
    const result = await factory.parse(filePath, fileType);

    if (!result.success) {
      throw new Error(result.error ?? `Parse failed for ${filename}`);
    }

    console.log(
      `[ProcessingQueue] Parsed ${filename}: ${result.text.length} chars (via ${factory.getProcessor(fileType).getStepLabel()})` +
        (result.raw ? `, raw JSON available` : "") +
        (result.doctags ? `, doctags available` : ""),
    );

    return result;
  }

  // -----------------------------------------------------------------------
  // Step 2: Compiling — create wiki pages (L2 fulltext, L1 overview, L0 abstract)
  // -----------------------------------------------------------------------

  private async stepCompiling(
    job: ProcessingJob,
    abortController: AbortController,
  ): Promise<void> {
    const { kbId, docId, filename } = job;
    const parsedContent = (job as ProcessingJob & { _parsedContent: ParsedContent })
      ._parsedContent;

    // Update DB status
    this.updateDbStatus(docId, "compiling", "compiling", 0.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "compiling",
      step: "compiling",
      progress: 0.0,
    });

    // Use WikiCompiler for three-layer compilation (Raw→Structure→Abstract)
    const router = new ModelRouter();
    await router.initialize();
    const dataDir = process.env.DATA_DIR ?? "data";
    const compiler = new WikiCompiler(router, dataDir);
    await compiler.compile(kbId, docId, parsedContent, {}, { skipStatusUpdates: true });

    // WikiCompiler.compile() calls updateDocumentStatus("ready") internally,
    // but we still need to set our processing_step tracking for the queue.
    // We update the step info without changing the overall status.
    this.updateDbStatus(docId, "compiling", "compiling", 1.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "compiling",
      step: "compiling",
      progress: 1.0,
    });
  }

  // -----------------------------------------------------------------------
  // Step 3: Indexing (Phase A: no-op placeholder)
  // -----------------------------------------------------------------------

  private async stepIndexing(
    job: ProcessingJob,
    abortController: AbortController,
  ): Promise<void> {
    const { kbId, docId, filename } = job;

    // Update DB status
    this.updateDbStatus(docId, "indexing", "indexing", 0.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "indexing",
      step: "indexing",
      progress: 0.0,
    });

    // Index the document's wiki pages into FTS5 and embeddings
    try {
      const { Indexer } = await import("../wiki/indexer.js");
      const { EmbeddingManager, setEmbeddingManager } = await import("../models/embedding.js");
      const router = new ModelRouter();
      await router.initialize();
      const embeddingManager = new EmbeddingManager(router);
      await embeddingManager.initialize();
      const indexer = new Indexer(embeddingManager);
      await indexer.indexDocument(kbId, docId);
      console.log(
        `[ProcessingQueue] Indexed ${filename} (${docId})`,
      );
    } catch (err) {
      // Indexing failure should not block the pipeline
      console.warn(
        `[ProcessingQueue] Indexing failed for ${filename} (${docId}):`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Update progress
    this.updateDbStatus(docId, "indexing", "indexing", 1.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "indexing",
      step: "indexing",
      progress: 1.0,
    });
  }

  // -----------------------------------------------------------------------
  // Step 4: Linking (Phase A: no-op placeholder)
  // -----------------------------------------------------------------------

  private async stepLinking(
    job: ProcessingJob,
    abortController: AbortController,
  ): Promise<void> {
    const { kbId, docId, filename } = job;

    // Update DB status
    this.updateDbStatus(docId, "linking", "linking", 0.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "linking",
      step: "linking",
      progress: 0.0,
    });

    // Use L0Linker to build cross-document associations based on shared entities
    const { L0Linker } = await import("../wiki/l0-linker.js");
    const l0Linker = new L0Linker();
    await l0Linker.buildL0Associations(kbId);

    console.log(
      `[ProcessingQueue] L0 linking completed for ${filename} (${docId})`,
    );

    // Update progress
    this.updateDbStatus(docId, "linking", "linking", 1.0);
    this.broadcast(kbId, "kb", {
      type: "doc_processing_step",
      kbId,
      docId,
      filename,
      status: "linking",
      step: "linking",
      progress: 1.0,
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Update document status in the database.
   * Sets status, processing_step, processing_progress, and optionally processing_error.
   */
  private async updateDbStatus(
    docId: string,
    status: string,
    step: string | null,
    progress: number,
    error?: string,
  ): Promise<void> {
    try {
      const repos = await getRepos();
      if (error !== undefined) {
        await repos.document.updateStatusWithProcessing(docId, status, step ?? "", progress, error);
      } else {
        await repos.document.updateStatusWithProcessing(docId, status, step ?? "", progress);
      }
    } catch (err) {
      console.error(
        `[ProcessingQueue] Failed to update DB status for ${docId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Broadcast a WebSocket event to a knowledge base channel.
   * Wrapped in try/catch so the queue works even when WS is not initialized.
   */
  private async broadcast(
    kbId: string,
    _channel: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      // Dynamic import — broadcastToKb may not exist yet.
      const wsModule = await import("../server/ws.js") as {
        broadcastToKb?: (kbId: string, payload: Record<string, unknown>) => void;
      };

      if (typeof wsModule.broadcastToKb === "function") {
        wsModule.broadcastToKb(kbId, payload);
      }
    } catch {
      // WS module not available or not initialized — this is fine.
    }
  }

  /**
   * Throw an error if the job has been aborted (cancelled).
   */
  private throwIfAborted(
    abortController: AbortController,
    docId: string,
  ): void {
    if (abortController.signal.aborted) {
      throw new Error(`Job ${docId} was aborted`);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let _instance: ProcessingQueue | null = null;

/**
 * Get the global ProcessingQueue singleton.
 * Created lazily on first access.
 */
export function getProcessingQueue(): ProcessingQueue {
  if (!_instance) {
    _instance = new ProcessingQueue();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetProcessingQueue(): void {
  _instance = null;
}
