// =============================================================================
// DeepAnalyze - Image Structure Compiler
// Compiles image raw data into a single Structure page with image anchor.
// =============================================================================

import type { WikiPageRepo, AnchorRepo, FTSSearchRepo } from '../../store/repos/interfaces.js';
import type { ImageRawData } from '../../services/document-processors/modality-types.js';
import type { AnchorGenerator } from '../anchor-generator.js';

export async function compileImageStructure(
  params: {
    kbId: string;
    docId: string;
    raw: ImageRawData;
    doctags: string;
    wikiPageRepo: WikiPageRepo;
    anchorRepo: AnchorRepo;
    ftsRepo: FTSSearchRepo;
    anchorGenerator: AnchorGenerator;
  },
): Promise<string[]> {
  const { kbId, docId, raw, doctags, wikiPageRepo, anchorRepo, ftsRepo, anchorGenerator } = params;

  // 1. Generate anchors
  const anchors = anchorGenerator.generateImageAnchors(docId, kbId, raw);
  await anchorRepo.batchInsert(anchors);

  // 2. Create single Structure page
  const title = '图片内容';
  const page = await wikiPageRepo.create({
    kb_id: kbId,
    doc_id: docId,
    page_type: 'structure',
    title,
    content: doctags,
    file_path: `${kbId}/documents/${docId}/structure/image.md`,
    metadata: {
      anchorIds: anchors.map(a => a.id),
      modality: 'image',
      elementTypes: ['image'],
      format: raw.format,
      dimensions: raw.width && raw.height ? `${raw.width}x${raw.height}` : undefined,
    },
  });

  // 3. Update anchor structure_page_id references
  await anchorRepo.updateStructurePageId(anchors.map(a => a.id), page.id);

  // 4. Create FTS index entry
  await ftsRepo.upsertFTSEntry(page.id, title, doctags);

  return [page.id];
}
