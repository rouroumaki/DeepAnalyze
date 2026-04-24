/**
 * Shared test fixtures and constants for E2E tests.
 */

// Test KB: "E2E测试库"
export const TEST_KB_ID = "3d7b3ebc-4cc4-4f1a-9792-977053bd211e";

// Document IDs within the test KB
export const DOC = {
  pdf: "f4cbc7c6-ee35-4e77-87f3-2e52eb2670fb",   // antigravity-rag-2026.pdf
  xlsx: "4a31999f-ed3c-44c8-b026-82026cbbb39d",    // athlete_events.xlsx
  jpg: "229306e6-7ea0-4f5e-9857-0ca42017020d",     // 20260314-172020.jpg
  mp3: "b26845a5-8635-4683-807d-1dbac0f2e831",     // 何老师遗言.mp3
  mp4: "f4194b35-08b8-48a1-a106-69ec704fe7a5",     // 小球放烟花.mp4
} as const;

// Expected file metadata
export const FILE_META = {
  [DOC.pdf]:  { name: "antigravity-rag-2026.pdf", size: 361300,   type: "pdf",  mime: "application/pdf" },
  [DOC.xlsx]: { name: "athlete_events.xlsx",       size: 22052672, type: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  [DOC.jpg]:  { name: "20260314-172020.jpg",       size: 286687,   type: "jpg",  mime: "image/jpeg" },
  [DOC.mp3]:  { name: "何老师遗言.mp3",            size: 6850507,  type: "mp3",  mime: "audio/mpeg" },
  [DOC.mp4]:  { name: "小球放烟花.mp4",             size: 2353287,  type: "mp4",  mime: "video/mp4" },
} as const;
