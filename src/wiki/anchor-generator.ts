/**
 * AnchorGenerator - Generates stable element-level anchor IDs from DoclingDocument JSON.
 * Anchors are position-based (not hash-based) to ensure they don't change on recompilation.
 */
export interface AnchorDef {
  id: string;
  doc_id: string;
  kb_id: string;
  element_type: string;
  element_index: number;
  section_path: string | null;
  section_title: string | null;
  page_number: number | null;
  raw_json_path: string;
  structure_page_id: string | null;
  content_preview: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown>;
}

const MAX_PREVIEW_LENGTH = 200;

const ELEMENT_TYPE_MAP: Record<string, string> = {
  heading: 'heading',
  paragraph: 'paragraph',
  text: 'paragraph',
  table: 'table',
  picture: 'image',
  figure: 'image',
  formula: 'formula',
  list: 'list',
  code: 'code',
};

export class AnchorGenerator {
  /**
   * Generate anchors from a DoclingDocument JSON structure.
   * Traverses body.children, tracks heading levels to build section_path.
   */
  generateAnchors(docId: string, kbId: string, raw: Record<string, unknown>): AnchorDef[] {
    const children = this.getBodyChildren(raw);
    if (!children || children.length === 0) return [];

    const anchors: AnchorDef[] = [];
    const counters: Record<string, number> = {};
    // Track heading levels: h1Count, lastH2Count
    let h1Count = 0;
    let h2Count = 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Record<string, unknown>;
      const rawType = String(child.type ?? 'unknown');
      const mappedType = ELEMENT_TYPE_MAP[rawType] ?? rawType;

      // Track heading hierarchy
      if (rawType === 'heading') {
        const level = Number(child.level ?? 1);
        if (level === 1) {
          h1Count++;
          h2Count = 0;
        } else if (level === 2) {
          h2Count++;
        }
      }

      // Build section_path
      let sectionPath: string | null = null;
      if (h1Count > 0) {
        sectionPath = h2Count > 0 ? `${h1Count}.${h2Count}` : `${h1Count}`;
      }

      // Per-type counter
      const typeCount = counters[mappedType] ?? 0;
      counters[mappedType] = typeCount + 1;

      const text = this.getText(child);
      const elementIndex = typeCount;

      anchors.push({
        id: `${docId}:${mappedType}:${elementIndex}`,
        doc_id: docId,
        kb_id: kbId,
        element_type: mappedType,
        element_index: elementIndex,
        section_path: sectionPath,
        section_title: rawType === 'heading' ? (text ?? null) : null,
        page_number: null,
        raw_json_path: `#/body/children/${i}`,
        structure_page_id: null,
        content_preview: text ? text.slice(0, MAX_PREVIEW_LENGTH) : null,
        content_hash: null,
        metadata: {},
      });
    }

    return anchors;
  }

  /**
   * Generate anchors for Excel documents.
   * ID format: docId:table:sheetName_tableIdx
   */
  generateExcelAnchors(docId: string, kbId: string, raw: Record<string, unknown>): AnchorDef[] {
    const children = this.getBodyChildren(raw);
    if (!children || children.length === 0) return [];

    const anchors: AnchorDef[] = [];
    let tableIdx = 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Record<string, unknown>;
      if (String(child.type) !== 'table') continue;

      const meta = (child.metadata ?? {}) as Record<string, unknown>;
      const sheetName = String(meta.sheetName ?? `sheet${tableIdx}`);
      const tIdx = Number(meta.tableIndex ?? 0);
      const text = this.getText(child);

      anchors.push({
        id: `${docId}:table:${sheetName}_${tIdx}`,
        doc_id: docId,
        kb_id: kbId,
        element_type: 'table',
        element_index: tableIdx,
        section_path: sheetName,
        section_title: `${sheetName} - 表格${tIdx + 1}`,
        page_number: null,
        raw_json_path: `#/body/children/${i}`,
        structure_page_id: null,
        content_preview: text ? text.slice(0, MAX_PREVIEW_LENGTH) : null,
        content_hash: null,
        metadata: { sheetName, tableIndex: tIdx },
      });
      tableIdx++;
    }

    return anchors;
  }

  private getBodyChildren(raw: Record<string, unknown>): unknown[] {
    const body = raw.body as Record<string, unknown> | undefined;
    return (body?.children as unknown[]) ?? [];
  }

  private getText(child: Record<string, unknown>): string | null {
    const text = child.text ?? child.content ?? null;
    return text ? String(text) : null;
  }
}
