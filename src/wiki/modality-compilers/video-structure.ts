// =============================================================================
// DeepAnalyze - Video Structure Compiler
// Compiles video raw data into Structure pages grouped by scene boundaries.
// Each page = one scene keyframe + related dialog turns within that time range.
// =============================================================================

import type { WikiPageRepo, AnchorRepo, FTSSearchRepo } from '../../store/repos/interfaces.js';
import type { VideoRawData } from '../../services/document-processors/modality-types.js';
import { DocTagsFormatters, formatTime } from '../../services/document-processors/modality-types.js';
import type { AnchorGenerator } from '../anchor-generator.js';

export async function compileVideoStructure(
  params: {
    kbId: string;
    docId: string;
    raw: VideoRawData;
    doctags: string;
    wikiPageRepo: WikiPageRepo;
    anchorRepo: AnchorRepo;
    ftsRepo: FTSSearchRepo;
    anchorGenerator: AnchorGenerator;
  },
): Promise<string[]> {
  const { kbId, docId, raw, wikiPageRepo, anchorRepo, ftsRepo, anchorGenerator } = params;

  // 1. Generate anchors
  const anchors = anchorGenerator.generateVideoAnchors(docId, kbId, raw);
  await anchorRepo.batchInsert(anchors);

  const sceneAnchors = anchors.filter(a => a.element_type === 'scene');
  const turnAnchors = anchors.filter(a => a.element_type === 'turn');
  const pageIds: string[] = [];

  // 2. Create a Structure page per scene
  for (let i = 0; i < raw.keyframes.length; i++) {
    const kf = raw.keyframes[i];
    const nextTime = i < raw.keyframes.length - 1 ? raw.keyframes[i + 1].time : raw.duration;

    // Find dialog turns within this scene's time range
    const sceneTurns = raw.transcript.turns.filter(
      t => t.startTime >= kf.time && t.startTime < nextTime,
    );
    const sceneTurnAnchors = sceneTurns.map(t => {
      const turnIdx = raw.transcript.turns.indexOf(t);
      return turnAnchors.find(a => a.raw_json_path === `#/transcript/turns/${turnIdx}`);
    }).filter((a): a is NonNullable<typeof a> => !!a);

    const title = `场景${i + 1} (${formatTime(kf.time)}-${formatTime(nextTime)})`;
    const content = DocTagsFormatters.videoScene(kf, sceneTurns);

    const page = await wikiPageRepo.create({
      kb_id: kbId,
      doc_id: docId,
      page_type: 'structure',
      title,
      content,
      file_path: `${kbId}/documents/${docId}/structure/scene_${i + 1}.md`,
      metadata: {
        anchorIds: [sceneAnchors[i]?.id, ...sceneTurnAnchors.map(a => a.id)].filter(Boolean),
        modality: 'video',
        elementTypes: ['scene', ...sceneTurns.map(() => 'turn')],
        timeRange: `${kf.time}-${nextTime}`,
        keyframeDescription: kf.description,
      },
    });

    // Update anchor associations
    const anchorIds = [sceneAnchors[i]?.id, ...sceneTurnAnchors.map(a => a.id)].filter(Boolean) as string[];
    await anchorRepo.updateStructurePageId(anchorIds, page.id);
    await ftsRepo.upsertFTSEntry(page.id, title, content);
    pageIds.push(page.id);
  }

  return pageIds;
}
