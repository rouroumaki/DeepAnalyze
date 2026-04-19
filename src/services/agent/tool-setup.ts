// =============================================================================
// DeepAnalyze - Tool Setup
// =============================================================================
// Creates a fully configured ToolRegistry with all custom DeepAnalyze tools
// (kb_search, wiki_browse, expand, report_generate, timeline_build, graph_build)
// registered and wired to their backends.
// =============================================================================

import { ToolRegistry } from "./tool-registry.js";
import { Retriever } from "../../wiki/retriever.js";
import { Linker } from "../../wiki/linker.js";
import { Expander } from "../../wiki/expander.js";
import type { EmbeddingManager } from "../../models/embedding.js";
import type { Indexer } from "../../wiki/indexer.js";
import type { ModelRouter } from "../../models/router.js";
import { getRepos } from "../../store/repos/index.js";
import { createReportTool } from "../../tools/ReportTool/index.js";
import { createTimelineTool } from "../../tools/TimelineTool/index.js";
import { createGraphTool } from "../../tools/GraphTool/index.js";

// ---------------------------------------------------------------------------
// Dependencies for tool registration
// ---------------------------------------------------------------------------

/** All external dependencies needed to set up the tool registry. */
export interface ToolSetupDeps {
  retriever: Retriever;
  linker: Linker;
  expander: Expander;
  embeddingManager: EmbeddingManager;
  indexer: Indexer;
  modelRouter: ModelRouter;
  /** Root data directory for wiki content files. */
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

/**
 * Create a ToolRegistry with all DeepAnalyze tools registered and wired to
 * their real backend implementations.
 *
 * The returned registry includes:
 * - think (built-in, always present)
 * - finish (built-in, always present)
 * - kb_search (Retriever-backed semantic + BM25 + link search)
 * - wiki_browse (page listing, content reading, link traversal)
 * - expand (layer-by-layer content expansion L0 -> L1 -> L2)
 * - report_generate (structured analysis report generation)
 * - timeline_build (chronological event extraction from wiki pages)
 * - graph_build (entity relationship graph from wiki pages and links)
 */
export async function createConfiguredToolRegistry(deps: ToolSetupDeps): Promise<ToolRegistry> {
  const registry = new ToolRegistry();

  // -----------------------------------------------------------------------
  // kb_search tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "kb_search",
    description:
      "Search the knowledge base using semantic and keyword matching. " +
      "Returns ranked results with snippets. Combines vector similarity, " +
      "BM25 full-text search, and link traversal for comprehensive results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text",
        },
        kbIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Knowledge base IDs to search within. Omit to search all KBs.",
        },
        topK: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
        linkedFrom: {
          type: "string",
          description:
            "Page ID to start link traversal from (adds linked results).",
        },
        pageTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter results to specific page types (abstract, overview, fulltext, entity, concept, report).",
        },
        minScore: {
          type: "number",
          description: "Minimum relevance score threshold (0-1 scale).",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>) {
      const query = input.query as string;
      const kbIds = (input.kbIds as string[]) || [];

      if (kbIds.length === 0) {
        // When no KB IDs are specified, search across all knowledge bases.
        // Retrieve all KB IDs from the database.
        const repos = await getRepos();
        const allKbs = await repos.knowledgeBase.list();
        const allKbIds = allKbs.map((kb) => kb.id);

        if (allKbIds.length === 0) {
          return {
            results: [],
            total: 0,
            message: "No knowledge bases found.",
          };
        }

        return deps.retriever.search(query, {
          kbIds: allKbIds,
          topK: (input.topK as number) || 10,
          linkedFrom: input.linkedFrom as string | undefined,
          pageTypes: input.pageTypes as string[] | undefined,
          minScore: input.minScore as number | undefined,
        });
      }

      return deps.retriever.search(query, {
        kbIds,
        topK: (input.topK as number) || 10,
        linkedFrom: input.linkedFrom as string | undefined,
        pageTypes: input.pageTypes as string[] | undefined,
        minScore: input.minScore as number | undefined,
      });
    },
  });

  // -----------------------------------------------------------------------
  // wiki_browse tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "wiki_browse",
    description:
      "Browse wiki pages and follow links between related documents. " +
      "Can view a specific page by ID, list pages in a knowledge base, " +
      "or explore linked pages through link traversal.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "Specific page ID to view. Returns page content and metadata.",
        },
        kbId: {
          type: "string",
          description:
            "Knowledge base ID. Returns a list of all pages in the KB.",
        },
        followLinks: {
          type: "boolean",
          description:
            "When viewing a page, also include outgoing and incoming links (default: false).",
        },
        depth: {
          type: "number",
          description:
            "Link traversal depth when followLinks is true (max 3, default: 1).",
        },
        pageType: {
          type: "string",
          description:
            "Filter pages by type when listing KB pages (abstract, overview, fulltext, entity, concept, report).",
        },
      },
    },
    async execute(input: Record<string, unknown>) {
      // Mode 1: View a specific page by ID
      if (input.pageId) {
        const pageId = input.pageId as string;
        const repos = await getRepos();
        const page = await repos.wikiPage.getById(pageId);

        if (!page) {
          return { error: `Page not found: ${pageId}` };
        }

        const content = page.content || "[Content could not be read]";

        const result: Record<string, unknown> = {
          id: page.id,
          kbId: page.kb_id,
          docId: page.doc_id,
          pageType: page.page_type,
          title: page.title,
          tokenCount: page.token_count,
          content,
        };

        // Optionally include link information
        if (input.followLinks) {
          const depth = Math.min((input.depth as number) || 1, 3);

          const outgoingLinks = await deps.linker.getOutgoingLinks(pageId);
          const incomingLinks = await deps.linker.getIncomingLinks(pageId);

          const linkedPages = await deps.linker.getLinkedPages(pageId, depth);

          result.outgoingLinks = outgoingLinks.map((link) => ({
            targetPageId: link.targetPageId,
            linkType: link.linkType,
            entityName: link.entityName,
          }));

          result.incomingLinks = incomingLinks.map((link) => ({
            sourcePageId: link.sourcePageId,
            linkType: link.linkType,
            entityName: link.entityName,
          }));

          result.linkedPages = linkedPages.map((lp) => ({
            pageId: lp.page.id,
            title: lp.page.title,
            pageType: lp.page.pageType,
            distance: lp.distance,
            linkType: lp.linkType,
          }));
        }

        return result;
      }

      // Mode 2: List pages in a knowledge base
      if (input.kbId) {
        const kbId = input.kbId as string;
        const pageType = input.pageType as string | undefined;
        const repos = await getRepos();
        const pages = await repos.wikiPage.getByKbAndType(kbId, pageType);

        return {
          kbId,
          total: pages.length,
          pages: pages.map((p) => ({
            id: p.id,
            docId: p.doc_id,
            pageType: p.page_type,
            title: p.title,
            tokenCount: p.token_count,
          })),
        };
      }

      return {
        error:
          'Provide either "pageId" to view a specific page, or "kbId" to list pages in a knowledge base.',
      };
    },
  });

  // -----------------------------------------------------------------------
  // expand tool
  // -----------------------------------------------------------------------

  registry.register({
    name: "expand",
    description:
      "Expand from summary to detailed content. Drills down through " +
      "L0 (abstract) -> L1 (overview) -> L2 (fulltext) layers. " +
      "Use this to get more detail on a document or page.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "Page ID to expand. Returns content at its current level.",
        },
        docId: {
          type: "string",
          description: "Document ID to expand to a specific level.",
        },
        targetLevel: {
          type: "string",
          enum: ["L0", "L1", "L2"],
          description:
            "Target expansion level when expanding by docId. L0=abstract, L1=overview, L2=fulltext.",
        },
        heading: {
          type: "string",
          description:
            "Specific section heading to extract within a page.",
        },
        tokenBudget: {
          type: "number",
          description:
            "Maximum tokens to return when expanding by docId. Automatically picks the best level.",
        },
      },
    },
    async execute(input: Record<string, unknown>) {
      try {
        // Mode 1: Expand a specific section by heading
        if (input.heading && input.pageId) {
          const result = await deps.expander.expandSection(
            input.pageId as string,
            input.heading as string,
          );

          if (!result) {
            return {
              error: `Section "${input.heading}" not found in page ${input.pageId}`,
            };
          }

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
          };
        }

        // Mode 2: Expand with token budget (automatically picks level)
        if (input.docId && input.tokenBudget) {
          const result = await deps.expander.expandWithBudget(
            input.docId as string,
            input.tokenBudget as number,
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        // Mode 3: Expand to a specific target level by docId
        if (input.docId && input.targetLevel) {
          const result = await deps.expander.expandToLevel(
            input.docId as string,
            input.targetLevel as "L0" | "L1" | "L2",
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        // Mode 4: Expand a page by pageId (returns current level + child pages)
        if (input.pageId) {
          const result = await deps.expander.expand(
            input.pageId as string,
          );

          return {
            pageId: result.pageId,
            docId: result.docId,
            level: result.level,
            title: result.title,
            content: result.content,
            tokenCount: result.tokenCount,
            childPages: result.childPages
              ? result.childPages.map((cp) => ({
                  pageId: cp.pageId,
                  level: cp.level,
                  title: cp.title,
                  tokenCount: cp.tokenCount,
                }))
              : undefined,
          };
        }

        return {
          error:
            'Provide at least "pageId" or "docId". Use "targetLevel" or "tokenBudget" with docId, or "heading" with pageId.',
        };
      } catch (err) {
        return {
          error: `Expand failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });

  // -----------------------------------------------------------------------
  // report_generate tool
  // -----------------------------------------------------------------------

  registry.register(createReportTool({ retriever: deps.retriever, dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // timeline_build tool
  // -----------------------------------------------------------------------

  registry.register(createTimelineTool({ retriever: deps.retriever, dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // graph_build tool
  // -----------------------------------------------------------------------

  registry.register(createGraphTool({ linker: deps.linker, retriever: deps.retriever, dataDir: deps.dataDir }));

  // -----------------------------------------------------------------------
  // read_file tool — read files from the data directory
  // -----------------------------------------------------------------------

  registry.register({
    name: "read_file",
    description:
      "Read the contents of a file. Returns the file content as text. " +
      "Use this to inspect uploaded documents, configuration files, logs, or any " +
      "file within the data directory. For files outside the data directory, " +
      "use the bash tool with 'cat <path>'. Supports text files, markdown, CSV, JSON, etc.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file (relative to data directory, or absolute within data/)",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (0-based, default: 0)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read (default: 2000)",
        },
      },
      required: ["path"],
    },
    async execute(input: Record<string, unknown>) {
      const { readFileSync, existsSync } = await import("node:fs");
      const { resolve, join } = await import("node:path");
      const rawPath = input.path as string;
      const offset = (input.offset as number) || 0;
      const limit = (input.limit as number) || 2000;

      // Resolve path relative to data directory for safety
      const safePath = resolve(deps.dataDir, rawPath.startsWith("/") ? rawPath.slice(1) : rawPath);
      if (!safePath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      if (!existsSync(safePath)) {
        return { error: `File not found: ${rawPath}` };
      }

      try {
        const content = readFileSync(safePath, "utf-8");
        const lines = content.split("\n");
        const sliced = lines.slice(offset, offset + limit);
        return {
          path: rawPath,
          totalLines: lines.length,
          showingLines: `${offset}-${Math.min(offset + limit, lines.length)}`,
          content: sliced.join("\n"),
        };
      } catch (err) {
        return { error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // grep tool — search file contents
  // -----------------------------------------------------------------------

  registry.register({
    name: "grep",
    description:
      "Search for a pattern in files within the data directory. " +
      "Returns matching lines with file paths and line numbers. " +
      "Supports basic text search and regex patterns.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Search pattern (text or regex)",
        },
        path: {
          type: "string",
          description: "Directory or file to search in (relative to data directory). Default: entire data dir.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of matching lines to return (default: 50)",
        },
      },
      required: ["pattern"],
    },
    async execute(input: Record<string, unknown>) {
      const { execSync } = await import("node:child_process");
      const { resolve } = await import("node:path");
      const pattern = input.pattern as string;
      const searchPath = input.path ? resolve(deps.dataDir, input.path as string) : deps.dataDir;
      const maxResults = (input.maxResults as number) || 50;

      if (!searchPath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      try {
        const escapedPattern = pattern.replace(/'/g, "'\\''");
        const result = execSync(
          `grep -rn --include='*.md' --include='*.txt' --include='*.csv' --include='*.json' --include='*.yaml' --include='*.yml' -E '${escapedPattern}' '${searchPath}' 2>/dev/null | head -${maxResults}`,
          { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024, timeout: 10000 },
        );

        const lines = result.trim().split("\n").filter(Boolean);
        return {
          pattern,
          matches: lines.length,
          results: lines.map((line) => {
            const colonIdx = line.indexOf(":");
            const secondColon = line.indexOf(":", colonIdx + 1);
            if (colonIdx > 0 && secondColon > 0) {
              return {
                file: line.substring(0, colonIdx).replace(deps.dataDir + "/", ""),
                line: parseInt(line.substring(colonIdx + 1, secondColon), 10),
                content: line.substring(secondColon + 1),
              };
            }
            return { raw: line };
          }),
        };
      } catch (err: unknown) {
        // grep returns exit code 1 when no matches found
        const execErr = err as { status?: number };
        if (execErr.status === 1) {
          return { pattern, matches: 0, results: [] };
        }
        return { error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // glob tool — find files by pattern
  // -----------------------------------------------------------------------

  registry.register({
    name: "glob",
    description:
      "Find files matching a pattern in the data directory. " +
      "Returns a list of matching file paths. Supports glob patterns like *.pdf, **/*.md, etc.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.md', '*.pdf', 'wiki/**/*.md')",
        },
        path: {
          type: "string",
          description: "Base directory for search (relative to data directory). Default: data root.",
        },
      },
      required: ["pattern"],
    },
    async execute(input: Record<string, unknown>) {
      const { glob } = await import("node:fs/promises");
      const { resolve, join } = await import("node:path");
      const pattern = input.pattern as string;
      const basePath = input.path ? resolve(deps.dataDir, input.path as string) : deps.dataDir;

      if (!basePath.startsWith(resolve(deps.dataDir))) {
        return { error: "Access denied: path outside data directory" };
      }

      try {
        const matches: string[] = [];
        for await (const entry of glob(pattern, { cwd: basePath })) {
          matches.push(entry);
        }
        return {
          pattern,
          base: input.path || "",
          totalFiles: matches.length,
          files: matches.slice(0, 200),
        };
      } catch (err) {
        return { error: `Glob failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // bash tool — execute shell commands
  // -----------------------------------------------------------------------

  registry.register({
    name: "bash",
    description:
      "Execute a shell command and return its output. Use with caution. " +
      "The working directory is the project data directory. " +
      "Commands time out after 30 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 30, max: 120)",
        },
      },
      required: ["command"],
    },
    async execute(input: Record<string, unknown>) {
      const { execSync } = await import("node:child_process");
      const command = input.command as string;
      const timeoutSec = Math.min((input.timeout as number) || 30, 120);

      try {
        const result = execSync(command, {
          encoding: "utf-8",
          cwd: deps.dataDir,
          timeout: timeoutSec * 1000,
          maxBuffer: 5 * 1024 * 1024,
        });
        return { exitCode: 0, output: result.trim() };
      } catch (err: unknown) {
        const execErr = err as { status?: number; stdout?: string; stderr?: string };
        return {
          exitCode: execErr.status ?? 1,
          output: (execErr.stdout as string || "").trim(),
          error: (execErr.stderr as string || "").trim() || (err instanceof Error ? err.message : String(err)),
        };
      }
    },
  });

  // -----------------------------------------------------------------------
  // web_search tool — search the web
  // -----------------------------------------------------------------------

  registry.register({
    name: "web_search",
    description:
      "Search the web for information. Returns search results with titles, URLs, and snippets. " +
      "Useful for finding current information not available in the knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        maxResults: {
          type: "number",
          description: "Maximum results to return (default: 10)",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>) {
      const args = input as { query: string; maxResults?: number };
      const backend = process.env.SEARCH_BACKEND ?? "searxng";
      const maxResults = args.maxResults ?? 10;

      try {
        if (backend === "serper") {
          const apiKey = process.env.SERPER_API_KEY;
          if (!apiKey) {
            return "Web search (Serper) is not configured. Set SERPER_API_KEY environment variable.";
          }

          const resp = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
              "X-API-KEY": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              q: args.query,
              num: maxResults,
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (!resp.ok) {
            return `Search request failed: HTTP ${resp.status}`;
          }

          const data = await resp.json() as {
            organic?: Array<{ title: string; link: string; snippet: string }>;
          };

          const results = (data.organic ?? []).slice(0, maxResults);
          if (results.length === 0) return `No results found for "${args.query}".`;

          return results
            .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.link}\n    ${r.snippet}`)
            .join("\n\n");
        } else {
          // SearXNG (self-hosted)
          const searxngUrl = process.env.SEARXNG_URL ?? "http://localhost:8888";
          const url = `${searxngUrl}/search?q=${encodeURIComponent(args.query)}&format=json&categories=general`;

          const resp = await fetch(url, {
            signal: AbortSignal.timeout(15000),
          });

          if (!resp.ok) {
            return `Search request failed: HTTP ${resp.status}. Check SearXNG at ${searxngUrl}`;
          }

          const data = await resp.json() as {
            results?: Array<{ title: string; url: string; content: string }>;
          };

          const results = (data.results ?? []).slice(0, maxResults);
          if (results.length === 0) return `No results found for "${args.query}".`;

          return results
            .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content}`)
            .join("\n\n");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
          return `Search request timed out for "${args.query}".`;
        }
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // -----------------------------------------------------------------------
  // Multimedia generation tools (TTS, image, video, music)
  // -----------------------------------------------------------------------

  const { CapabilityDispatcher } = await import("../../models/capability-dispatcher.js");
  const dispatcher = new CapabilityDispatcher();

  registry.register({
    name: "tts_generate",
    description:
      "Generate speech audio from text. Converts text input to natural-sounding speech. " +
      "Returns the audio file path and metadata. Supports Chinese and English.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to convert to speech",
        },
        voice: {
          type: "string",
          description: "Voice name (default: male-qn-qingse)",
        },
        speed: {
          type: "number",
          description: "Speech speed (default: 1.0)",
        },
      },
      required: ["text"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.textToSpeech(input.text as string, {
          voice: input.voice as string | undefined,
          speed: input.speed as number | undefined,
        });

        // Save audio to data directory
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const filename = `tts-${Date.now()}.mp3`;
        const filePath = join(deps.dataDir, "generated", filename);
        writeFileSync(filePath, Buffer.from(result.audio));

        return {
          success: true,
          filePath: `generated/${filename}`,
          contentType: result.contentType,
          sizeBytes: result.audio.byteLength,
        };
      } catch (err) {
        return { error: `TTS generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  registry.register({
    name: "image_generate",
    description:
      "Generate an image from a text description. Creates a visual based on the prompt. " +
      "Returns the image file path.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Image generation prompt describing the desired image",
        },
        width: {
          type: "number",
          description: "Image width in pixels",
        },
        height: {
          type: "number",
          description: "Image height in pixels",
        },
      },
      required: ["prompt"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.generateImage(input.prompt as string, {
          width: input.width as number | undefined,
          height: input.height as number | undefined,
        });

        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(deps.dataDir, "generated");
        mkdirSync(dir, { recursive: true });
        const filename = `image-${Date.now()}.png`;
        writeFileSync(join(dir, filename), Buffer.from(result.image));

        return {
          success: true,
          filePath: `generated/${filename}`,
          contentType: result.contentType,
          sizeBytes: result.image.byteLength,
        };
      } catch (err) {
        return { error: `Image generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  registry.register({
    name: "video_generate",
    description:
      "Generate a video from a text prompt. Creates an AI video (may take several minutes). " +
      "Returns the video file URL or path.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Video generation prompt describing the desired video content",
        },
      },
      required: ["prompt"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.generateVideo(input.prompt as string);

        return {
          success: true,
          fileUrl: result.fileUrl,
          contentType: result.contentType,
        };
      } catch (err) {
        return { error: `Video generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  registry.register({
    name: "music_generate",
    description:
      "Generate music from a text prompt. Creates an audio file based on the description. " +
      "Returns the audio file path.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Music generation prompt describing the desired music style/mood",
        },
        duration: {
          type: "number",
          description: "Desired duration in seconds",
        },
      },
      required: ["prompt"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const result = await dispatcher.generateMusic(input.prompt as string, {
          duration: input.duration as number | undefined,
        });

        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(deps.dataDir, "generated");
        mkdirSync(dir, { recursive: true });
        const filename = `music-${Date.now()}.mp3`;
        writeFileSync(join(dir, filename), Buffer.from(result.audio));

        return {
          success: true,
          filePath: `generated/${filename}`,
          contentType: result.contentType,
          sizeBytes: result.audio.byteLength,
        };
      } catch (err) {
        return { error: `Music generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  return registry;
}

// ---------------------------------------------------------------------------
// workflow_run tool registration (for multi-agent workflows)
// ---------------------------------------------------------------------------

/** Dependencies needed to register the workflow_run tool. */
export interface WorkflowRunDeps {
  runner: any;
  toolRegistry: ToolRegistry;
  getTeamManager: () => Promise<any>;
  emitWs: (event: any) => void;
}

/**
 * Register the workflow_run tool on an existing ToolRegistry.
 *
 * This is called during orchestrator initialization (after the AgentRunner
 * and ToolRegistry have been created) to enable multi-agent workflow execution.
 */
export async function registerWorkflowRunTool(registry: ToolRegistry, deps: WorkflowRunDeps): Promise<void> {
  const { createWorkflowRunTool } = await import("./tools/workflow-run.js");
  registry.register(createWorkflowRunTool({
    runner: deps.runner,
    toolRegistry: deps.toolRegistry,
    onEvent: deps.emitWs,
  }));
}
