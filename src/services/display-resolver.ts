import type pg from 'pg';
import { getPool } from '../store/pg';

export interface DisplayInfo {
  originalName: string;
  kbName: string;
  displayLabel: string;
  fileType: string;
  modalityIcon: string;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: '📄', docx: '📄', pptx: '📄',
  xlsx: '📊', xls: '📊', csv: '📊',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
  mp3: '🎙️', wav: '🎙️',
  mp4: '📹', avi: '📹', mov: '📹',
};

/**
 * Resolves internal docId to user-visible display names.
 * Queries documents + knowledge_bases tables, with in-memory cache.
 */
export class DisplayResolver {
  private poolPromise: Promise<pg.Pool>;
  private cache: Map<string, DisplayInfo> = new Map();

  constructor() {
    this.poolPromise = getPool();
  }

  /** Resolve a single docId to its display info. */
  async resolve(docId: string): Promise<DisplayInfo> {
    const cached = this.cache.get(docId);
    if (cached) return cached;

    const results = await this.resolveBatch([docId]);
    return results[docId] ?? {
      originalName: docId,
      kbName: '',
      displayLabel: docId,
      fileType: '',
      modalityIcon: '',
    };
  }

  /** Resolve multiple docIds in one query to avoid N+1. */
  async resolveBatch(docIds: string[]): Promise<Record<string, DisplayInfo>> {
    const uncached = docIds.filter(id => !this.cache.has(id));
    const result: Record<string, DisplayInfo> = {};

    // Populate from cache
    for (const id of docIds) {
      const cached = this.cache.get(id);
      if (cached) result[id] = cached;
    }

    if (uncached.length > 0) {
      const pool = await this.poolPromise;
      const { rows } = await pool.query(
        `SELECT d.id, d.filename as original_name, kb.name as kb_name,
                d.file_type
         FROM documents d
         JOIN knowledge_bases kb ON kb.id = d.kb_id
         WHERE d.id = ANY($1)`,
        [uncached],
      );

      for (const row of rows) {
        const info: DisplayInfo = {
          originalName: row.original_name,
          kbName: row.kb_name,
          displayLabel: `${row.kb_name}/${row.original_name}`,
          fileType: row.file_type ?? '',
          modalityIcon: FILE_TYPE_ICONS[row.file_type] ?? '📄',
        };
        this.cache.set(row.id, info);
        result[row.id] = info;
      }

      // Fill in fallbacks for uncached IDs not found in DB
      for (const id of uncached) {
        if (!result[id]) {
          const fallback: DisplayInfo = {
            originalName: id,
            kbName: '',
            displayLabel: id,
            fileType: '',
            modalityIcon: '',
          };
          this.cache.set(id, fallback);
          result[id] = fallback;
        }
      }
    }

    return result;
  }
}
