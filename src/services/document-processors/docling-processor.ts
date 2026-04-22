import { resolve } from "node:path";
import type { DocumentProcessor, ParsedContent } from "./types.js";
import { getRepos } from "../../store/repos/index.js";

// ---------------------------------------------------------------------------
// Docling availability cache
// ---------------------------------------------------------------------------

let doclingAvailable: boolean | null = null;

/**
 * Check whether the Docling Python service can be started.
 * Result is cached after the first successful check (positive or negative).
 * Failed checks due to timeouts or transient errors are NOT cached,
 * allowing retries on subsequent parse attempts.
 */
async function checkDoclingAvailable(): Promise<boolean> {
  if (doclingAvailable !== null) return doclingAvailable;

  try {
    const { SubprocessManager } = await import("../../subprocess/manager.js");
    const { startDocling } = await import("../../subprocess/docling-client.js");

    const dataDir = process.env.DATA_DIR ?? "data";
    const projectRoot = resolve(dataDir, "..");

    const mgr = new SubprocessManager();
    await startDocling(projectRoot, mgr);

    // Wait for the process to either stabilize or crash.
    // Use 5s to accommodate slower environments (model downloads, cold starts).
    await new Promise((r) => setTimeout(r, 5000));

    // If the process already exited, docling is not available
    const running = mgr.isRunning("docling");
    if (running) {
      await mgr.stop("docling");
      doclingAvailable = true;
    } else {
      // Do NOT cache negative results — allow retry on next parse call
      console.warn("[DoclingProcessor] Docling process exited during availability check, will retry next time");
    }

    return running;
  } catch (err) {
    console.warn(
      `[DoclingProcessor] Docling not available: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Do NOT cache failures — transient issues should be retried
    return false;
  }
}

// ---------------------------------------------------------------------------
// DoclingProcessor
// ---------------------------------------------------------------------------

export class DoclingProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set([
    // Documents (xlsx/xls handled by NativeExcelProcessor)
    "pdf", "docx", "doc", "pptx", "ppt", "xlsm",
    // Web
    "html", "htm",
    // Text (MarkdownDocumentBackend)
    "md", "txt", "csv", "asciidoc", "adoc", "asc", "latex", "tex",
    // Images (ImageDocumentBackend)
    "jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp",
    // Audio (AsrPipeline)
    "wav", "mp3", "m4a", "aac", "ogg", "flac",
  ]);

  canHandle(fileType: string): boolean {
    return DoclingProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "docling_parsing";
  }

  async parse(filePath: string): Promise<ParsedContent> {
    const available = await checkDoclingAvailable();
    if (!available) {
      return {
        text: "",
        metadata: { sourceType: "docling" },
        success: false,
        error: "Docling 服务不可用。请确认已安装 docling Python 包 (pip install docling) 且 Python 环境正常。",
        modality: "document",
      };
    }

    const { SubprocessManager } = await import("../../subprocess/manager.js");
    const { startDocling, parseWithDocling } = await import("../../subprocess/docling-client.js");

    const dataDir = process.env.DATA_DIR ?? "data";
    const projectRoot = resolve(dataDir, "..");

    // Read docling config from settings
    const repos = await getRepos();
    const rawDoclingConfig = await repos.settings.get("docling_config");
    const defaultDoclingConfig = {
      layout_model: "docling-project/docling-layout-egret-xlarge",
      ocr_engine: "rapidocr" as const,
      ocr_backend: "torch" as const,
      table_mode: "accurate" as const,
      use_vlm: false,
      vlm_model: "",
    };
    const doclingConfig = rawDoclingConfig
      ? { ...defaultDoclingConfig, ...JSON.parse(rawDoclingConfig) }
      : defaultDoclingConfig;
    const artifactsPath = resolve(dataDir, "models", "docling");

    const modelConfig: Record<string, unknown> = {
      layout_model: doclingConfig.layout_model,
      ocr_engine: doclingConfig.ocr_engine,
      ocr_backend: doclingConfig.ocr_backend,
      table_mode: doclingConfig.table_mode,
      use_vlm: doclingConfig.use_vlm,
      vlm_model: doclingConfig.vlm_model,
      artifacts_path: artifactsPath,
    };

    // Resolve to absolute path — the docling subprocess CWD is docling-service/,
    // so relative paths like "data/original/..." would not resolve correctly.
    const absFilePath = resolve(filePath);

    const mgr = new SubprocessManager();
    try {
      await startDocling(projectRoot, mgr);
      const result = await parseWithDocling(mgr, absFilePath, {
        ocr: true,
        extract_tables: true,
        use_vlm: doclingConfig.use_vlm,
        model_config: modelConfig,
      });

      return {
        text: result.content,
        metadata: { sourceType: "docling" },
        success: true,
        raw: result.raw,
        doctags: result.doctags,
        markdown: result.content || "",
        modality: "document",
      };
    } catch (err) {
      return {
        text: "",
        metadata: { sourceType: "docling" },
        success: false,
        error: `Docling 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        modality: "document",
      };
    } finally {
      try { await mgr.stop("docling"); } catch { /* ignore */ }
    }
  }
}
