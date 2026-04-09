// =============================================================================
// DeepAnalyze - Wiki Compiler (L0/L1/L2)
// The core compilation engine that transforms parsed document content into
// a layered wiki structure: fulltext (L2) -> overview (L1) -> abstract (L0).
// =============================================================================

import { ModelRouter } from "../models/router.js";
import { PageManager } from "./page-manager.js";
import {
  EntityExtractor,
  type ExtractedEntity,
} from "./entity-extractor.js";
import {
  createWikiPage,
  getWikiPageByDoc,
  getPageContent,
} from "../store/wiki-pages.js";
import { updateDocumentStatus } from "../store/documents.js";
import { DB } from "../store/database.js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export class WikiCompiler {
  private router: ModelRouter;
  private pageManager: PageManager;
  private entityExtractor: EntityExtractor;

  constructor(router: ModelRouter, dataDir: string) {
    this.router = router;
    this.pageManager = new PageManager(dataDir);
    this.entityExtractor = new EntityExtractor(router);
  }

  /**
   * Full compilation pipeline for a single document.
   *
   * Stages:
   *  1. L2 - Save parsed markdown as fulltext page
   *  2. L1 - Generate structured overview from fulltext via LLM
   *  3. L0 - Compress overview to one-line abstract via LLM
   *  4. Extract entities from overview and create entity pages
   */
  async compile(
    kbId: string,
    docId: string,
    parsedContent: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      updateDocumentStatus(docId, "compiling");

      // Ensure the KB wiki directory structure exists
      await this.pageManager.initKb(kbId);

      // Step 1: Save L2 fulltext
      await this.compileL2(kbId, docId, parsedContent, metadata);

      // Step 2: Generate L1 overview from fulltext
      await this.compileL1(kbId, docId, parsedContent);

      // Step 3: Generate L0 abstract from L1
      await this.compileL0(kbId, docId);

      // Step 4: Extract entities and create entity pages / wiki_links
      await this.extractAndUpdateLinks(kbId, docId);

      updateDocumentStatus(docId, "ready");
    } catch (err) {
      console.error(
        `[WikiCompiler] Compilation failed for doc ${docId}:`,
        err instanceof Error ? err.message : String(err),
      );
      updateDocumentStatus(docId, "error");
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // L2: Fulltext - save the parsed markdown content as-is
  // -------------------------------------------------------------------------

  private async compileL2(
    kbId: string,
    docId: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const wikiDir = this.pageManager.getWikiDir();

    // Save parsed markdown as L2 fulltext page
    createWikiPage(
      kbId,
      docId,
      "fulltext",
      `Document: ${docId}`,
      content,
      wikiDir,
    );

    // Also save metadata.json alongside the parsed content
    const metadataPath = join(
      wikiDir,
      kbId,
      "documents",
      docId,
      "metadata.json",
    );
    try {
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    } catch (err) {
      console.warn(
        `[WikiCompiler] Failed to write metadata for doc ${docId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // -------------------------------------------------------------------------
  // L1: Overview - generate structured overview from fulltext via LLM
  // -------------------------------------------------------------------------

  private async compileL1(
    kbId: string,
    docId: string,
    fullContent: string,
  ): Promise<void> {
    // Truncate content if too long for model input (~6000 chars max for prompt)
    const truncated =
      fullContent.length > 6000
        ? fullContent.slice(0, 6000) + "\n...(truncated)"
        : fullContent;

    const prompt = `请为以下文档内容生成一份结构化概览（约2000字），包含：
1. 文档结构导航（各章节标题和核心摘要）
2. 关键实体列表（人物、机构、地点、时间、金额等）
3. 核心要点总结

文档内容：
${truncated}`;

    let response: string;
    try {
      const result = await this.router.chat(
        [{ role: "user", content: prompt }],
        { model: this.router.getDefaultModel("summarizer") },
      );
      response = result.content;
    } catch (err) {
      console.warn(
        `[WikiCompiler] L1 generation failed for doc ${docId}, using truncated content as fallback:`,
        err instanceof Error ? err.message : String(err),
      );
      // Fallback: use truncated content as the overview
      response = `# Document Overview (auto-generated)\n\n${truncated}`;
    }

    createWikiPage(
      kbId,
      docId,
      "overview",
      `Overview: ${docId}`,
      response,
      this.pageManager.getWikiDir(),
    );
  }

  // -------------------------------------------------------------------------
  // L0: Abstract - compress L1 overview to a one-line summary
  // -------------------------------------------------------------------------

  private async compileL0(kbId: string, docId: string): Promise<void> {
    // Read L1 overview
    const l1Page = getWikiPageByDoc(docId, "overview");
    if (!l1Page) {
      console.warn(
        `[WikiCompiler] L1 overview not found for doc ${docId}, skipping L0`,
      );
      return;
    }

    let l1Content: string;
    try {
      l1Content = getPageContent(l1Page.filePath);
    } catch (err) {
      console.warn(
        `[WikiCompiler] Failed to read L1 content for doc ${docId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    // Truncate L1 content if needed
    const truncated =
      l1Content.length > 4000
        ? l1Content.slice(0, 4000) + "\n...(truncated)"
        : l1Content;

    const prompt = `请将以下文档概览压缩为一句话摘要（不超过100字），然后列出5-10个关键标签（用逗号分隔）。
格式要求：
第一行：摘要
第二行：标签：标签1,标签2,...

文档概览：
${truncated}`;

    let response: string;
    try {
      const result = await this.router.chat(
        [{ role: "user", content: prompt }],
        { model: this.router.getDefaultModel("summarizer") },
      );
      response = result.content;
    } catch (err) {
      console.warn(
        `[WikiCompiler] L0 generation failed for doc ${docId}, using first line of L1 as fallback:`,
        err instanceof Error ? err.message : String(err),
      );
      // Fallback: use first 200 chars of L1 as abstract
      response = l1Content.slice(0, 200).split("\n")[0] || "No abstract available.";
    }

    createWikiPage(
      kbId,
      docId,
      "abstract",
      `Abstract: ${docId}`,
      response,
      this.pageManager.getWikiDir(),
    );
  }

  // -------------------------------------------------------------------------
  // Entity extraction and link creation
  // -------------------------------------------------------------------------

  private async extractAndUpdateLinks(
    kbId: string,
    docId: string,
  ): Promise<void> {
    // Read L1 overview for entity extraction
    const l1Page = getWikiPageByDoc(docId, "overview");
    if (!l1Page) {
      console.warn(
        `[WikiCompiler] L1 overview not found for doc ${docId}, skipping entity extraction`,
      );
      return;
    }

    let l1Content: string;
    try {
      l1Content = getPageContent(l1Page.filePath);
    } catch (err) {
      console.warn(
        `[WikiCompiler] Failed to read L1 content for entity extraction, doc ${docId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    // Extract entities using the model
    const entities = await this.entityExtractor.extract(l1Content);

    if (entities.length === 0) {
      return;
    }

    const db = DB.getInstance().raw;
    const wikiDir = this.pageManager.getWikiDir();

    for (const entity of entities) {
      try {
        // Check if entity page already exists for this KB
        const existing = db
          .prepare(
            "SELECT id FROM wiki_pages WHERE kb_id = ? AND title = ? AND page_type = 'entity'",
          )
          .get(kbId, entity.name) as { id: string } | undefined;

        if (!existing) {
          // Create new entity page
          createWikiPage(
            kbId,
            null,
            "entity",
            entity.name,
            `# ${entity.name}\n\n类型: ${entity.type}\n\n出现上下文:\n- ${entity.mentions.join("\n- ")}`,
            wikiDir,
          );
        }

        // Create a wiki_link from the document's overview page to the entity page
        const entityPage = db
          .prepare(
            "SELECT id FROM wiki_pages WHERE kb_id = ? AND title = ? AND page_type = 'entity'",
          )
          .get(kbId, entity.name) as { id: string } | undefined;

        if (entityPage && l1Page) {
          // Check if link already exists to avoid duplicates
          const existingLink = db
            .prepare(
              "SELECT id FROM wiki_links WHERE source_page_id = ? AND target_page_id = ? AND entity_name = ?",
            )
            .get(l1Page.id, entityPage.id, entity.name) as
            | { id: string }
            | undefined;

          if (!existingLink) {
            const linkId = randomUUID();
            db.prepare(
              `INSERT INTO wiki_links (id, source_page_id, target_page_id, link_type, entity_name, context)
               VALUES (?, ?, ?, 'entity_ref', ?, ?)`,
            ).run(
              linkId,
              l1Page.id,
              entityPage.id,
              entity.name,
              entity.mentions[0] ?? null,
            );
          }
        }
      } catch (err) {
        // Log but don't fail the entire compilation for one entity
        console.warn(
          `[WikiCompiler] Failed to process entity "${entity.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }
}
