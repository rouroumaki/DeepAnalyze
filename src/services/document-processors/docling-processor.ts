import { resolve } from "node:path";
import type { DocumentProcessor, ParsedContent } from "./types.js";
import { getRepos } from "../../store/repos/index.js";

// ---------------------------------------------------------------------------
// Docling availability cache
// ---------------------------------------------------------------------------

let doclingAvailable: boolean | null = null;

/**
 * Check whether the Docling Python service can be started.
 * Result is cached after the first check.
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

    // Give it a moment to crash if imports fail
    await new Promise((r) => setTimeout(r, 2000));

    // If the process already exited, docling is not available
    const running = mgr.isRunning("docling");
    if (running) {
      await mgr.stop("docling");
    }

    doclingAvailable = running;
    return doclingAvailable;
  } catch (err) {
    console.warn(
      `[DoclingProcessor] Docling not available: ${err instanceof Error ? err.message : String(err)}`,
    );
    doclingAvailable = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// DoclingProcessor
// ---------------------------------------------------------------------------

export class DoclingProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set(["pdf", "docx", "doc", "pptx", "ppt"]);

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
