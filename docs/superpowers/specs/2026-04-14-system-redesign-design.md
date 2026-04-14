# DeepAnalyze System Redesign Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign 6 systemic issues found during deep testing — upload failures, state persistence, unified search, report integration, report noise, and multi-agent parallelism.

**Architecture:** Three-layer system: Input Layer (upload + chat), Core Engine (search + agents + reports), Display Layer (embedded reports + state persistence). Multi-agent uses a three-tier architecture: bottom (AgentRunner + Orchestrator), middle (WorkflowEngine with 4 scheduling modes), top (4 entry points for multi-agent dispatch).

**Tech Stack:** React + Zustand, Hono (backend), better-sqlite3, WebSocket, existing AgentRunner/Orchestrator, WorkflowEngine (ported from CountBot).

---

## Module A: File Upload + State Persistence

### A.1 Upload Pipeline Improvements

**Problem:** Files can't upload in WSL environment, no feedback during upload, no timeout, no retry.

**Solution:**

- Non-blocking upload: upload runs in background, UI remains interactive
- 30-second timeout per upload attempt
- Auto-retry 2 times on failure
- Polling fallback: when WebSocket disconnects, poll document status every 3 seconds
- Detailed progress stages: Upload% -> Parsing -> Compiling -> Indexing -> Linking -> Ready
- Error recovery: failed files show retry button

**Upload Progress Stages Detail:**

| Stage | Description | Progress % |
|-------|-------------|------------|
| Upload | Transferring file bytes to server | 0-40% |
| Parsing | Extracting text from document format | 40-55% |
| Compiling | Building internal document structure | 55-70% |
| Indexing | Creating search index entries | 70-85% |
| Linking | Building entity links and cross-references | 85-95% |
| Ready | Document available for search and analysis | 100% |

**Retry Logic:**

```
attempt = 1
maxAttempts = 3

function uploadWithRetry(file):
  while attempt <= maxAttempts:
    try:
      result = await upload(file, { timeout: 30000 })
      return result
    catch (error):
      if attempt == maxAttempts:
        showRetryButton(file)
        return { status: "failed", error }
      attempt++
      await delay(1000 * attempt) // exponential backoff: 1s, 2s
```

**Polling Fallback Logic:**

```
// When WebSocket disconnects, start polling
ws.onDisconnect = () => {
  pollInterval = setInterval(async () => {
    const status = await fetch(`/api/knowledge/${kbId}/documents/${docId}/status`)
    updateProgress(status)
    if (status.stage === "Ready" || status.stage === "Failed") {
      clearInterval(pollInterval)
    }
  }, 3000)
}
```

**Files to modify:**

- `frontend/src/components/knowledge/KnowledgePanel.tsx` -- add non-blocking upload with progress
- `frontend/src/api/client.ts` -- add upload with timeout and retry
- `src/server/routes/knowledge.ts` -- ensure upload endpoint returns immediate acknowledgment

### A.2 State Persistence -- URL Routing + localStorage

**Problem:** Page refresh loses all state (active view, session, KB selection, scope).

**Solution: Dual-layer persistence**

**URL Routes:**

| Route | View |
|-------|------|
| `/chat` | Chat view |
| `/knowledge/:kbId` | Knowledge base |
| `/knowledge/:kbId/search` | Search |
| `/reports` | Reports list |
| `/reports/:reportId` | Single report |
| `/tasks` | Task list |
| `/sessions/:sessionId` | Specific session |

**localStorage Keys:**

| Key | Purpose |
|-----|---------|
| `deepanalyze-theme` | Theme preference |
| `deepanalyze-session` | Current session ID |
| `deepanalyze-kb` | Current knowledge base ID |
| `deepanalyze-sidebar` | Sidebar open/closed state |
| `deepanalyze-scope` | Analysis scope selection |

**Refresh flow:** URL parsing -> determine view -> restore UI state from localStorage -> load server data via API -> render complete.

**Detailed Refresh Flow:**

```
1. User refreshes page or navigates to a URL
2. Router parses URL path and query parameters
   - Extract route segments (e.g., /knowledge/abc123/search)
   - Extract query params (e.g., ?q=keyword)
3. Determine active view from route
   - Match route to view component
   - Set active view in Zustand store
4. Restore supplementary state from localStorage
   - Theme preference
   - Sidebar state
   - Last-used scope
5. Load server data via API
   - If session ID in URL or localStorage, fetch session
   - If kbId in URL, fetch KB details and document list
   - If search query in URL params, execute search
6. Render complete view with all data
```

**Example:** Refresh `/knowledge/abc123/search?q=夏某某` -> auto-select KB abc123 -> search "夏某某" -> show results.

**Router Implementation Approach:**

Use react-router v6 with hash-based routing for WSL compatibility. The router wraps the entire App component and maps URL patterns to view components. Each route change triggers both a URL update and a Zustand store update to keep them in sync.

```typescript
// router.tsx structure
const router = createHashRouter([
  { path: "/chat", element: <ChatView /> },
  { path: "/knowledge/:kbId", element: <KnowledgeView /> },
  { path: "/knowledge/:kbId/search", element: <KnowledgeView initialTab="search" /> },
  { path: "/reports", element: <ReportsView /> },
  { path: "/reports/:reportId", element: <ReportDetailView /> },
  { path: "/tasks", element: <TasksView /> },
  { path: "/sessions/:sessionId", element: <ChatView /> },
  { path: "/", element: <Navigate to="/chat" replace /> },
])
```

**Files to create/modify:**

- Create `frontend/src/router.tsx` -- URL routing with react-router or custom hash router
- Modify `frontend/src/App.tsx` -- integrate router
- Modify `frontend/src/store/ui.ts` -- sync state to localStorage and URL
- Modify `frontend/src/store/chat.ts` -- persist session ID

### A.3 Document List Batch Operations

**Features:**

- Select all / individual select checkboxes
- Batch delete (selected count shown)
- Batch re-process
- Status indicators: Ready (green checkmark), Processing (spinning icon with %), Failed (red icon with retry)

**Batch Operations UI Detail:**

| Operation | Behavior | Confirmation |
|-----------|----------|--------------|
| Select All | Check all documents in current view | None |
| Individual Select | Toggle single document checkbox | None |
| Batch Delete | Delete all selected documents | Modal: "Delete N documents? This cannot be undone." |
| Batch Re-process | Re-run processing pipeline on selected | None (starts immediately) |
| Retry Failed | Retry only documents with Failed status | None |

**Status Indicators:**

| Status | Icon | Color | Interaction |
|--------|------|-------|-------------|
| Ready | Checkmark | Green | Click to view |
| Processing | Spinner with % | Blue | Click to see progress detail |
| Failed | X mark | Red | Click to retry |
| Queued | Clock | Gray | None |

**Files to modify:**

- `frontend/src/components/knowledge/KnowledgePanel.tsx` -- add batch selection and operations

---

## Module B: Unified Search System

### B.1 Unified Search Interface

**Problem:** Search, Wiki, and Preview are disconnected modules. User wants a single unified search with hierarchical results.

**Solution: Single search entry point, results displayed by level**

**Search Results Layout:**

- **L0 Results** (green badge): Abstract-level matches, fastest
- **L1 Results** (blue badge): Overview-level matches, richer context
- **L2 Results** (yellow badge): Raw text fragment matches, precise to paragraph
- **Entity Results** (purple badge): Matching entities with occurrence counts

Each result shows: title, highlighted snippet (keyword highlighted in yellow), source document info, level badge.

**Unified Search API:**

```
GET /api/knowledge/:kbId/search

Parameters:
  q: "夏某某"                    // search keyword
  levels: "L0,L1,L2"            // which levels to return (default all)
  entities: true                 // whether to return entity matches
  limit: 10                      // max results per level
  offset: 0                      // pagination

Response:
{
  "query": "夏某某",
  "results": {
    "L0": [{ "pageId", "title", "snippet", "highlights" }],
    "L1": [{ "pageId", "title", "snippet", "highlights" }],
    "L2": [{ "pageId", "title", "snippet", "highlights" }]
  },
  "entities": [{ "name", "type", "count", "relatedPages" }],
  "total": 19
}
```

**Search Performance Requirements:**

| Metric | Target |
|--------|--------|
| L0 search latency | < 200ms |
| L1 search latency | < 500ms |
| L2 search latency | < 1000ms |
| Entity search latency | < 300ms |
| Combined response time | < 1500ms |

**Keyword Highlighting:**

Search keywords are highlighted in result snippets using `<mark>` tags. The highlighting algorithm:

1. Tokenize the query string
2. For each token, find all case-insensitive occurrences in the snippet
3. Wrap matches in `<mark class="search-highlight">` tags
4. For multi-token queries, highlight each token independently

**Files to create/modify:**

- Create `src/server/routes/search.ts` -- unified search endpoint
- Create `frontend/src/components/search/UnifiedSearch.tsx` -- search UI with level tabs
- Create `frontend/src/components/search/SearchResultCard.tsx` -- individual result card
- Modify `src/wiki/retriever.ts` -- support multi-level search with keyword highlighting

### B.2 Hover Preview Cards

**Behavior:** Mouse hover over any search result -> popup preview card showing document content with keyword highlights.

**Preview Card Content:**

- Header: document title + level + size
- Body: content snippet with keywords highlighted
- Footer: upload date + "Open full page" link

**Preview Card Implementation Detail:**

```
Appearance:
+-------------------------------------------+
| 案件基本情况        L1 概述     5.8KB      |
+-------------------------------------------+
| ...夏某某在2023年3月期间，通过其控制的     |
| 多个银行账户进行资金往来...                |
| ...经查明，夏某某与张某存在...             |
+-------------------------------------------+
| 2024-01-15  |  Open full page ->          |
+-------------------------------------------+

Trigger: mouseenter on search result card
Dismiss: mouseleave (300ms delay to prevent flicker)
Load: fetch preview content via API on first hover, cache for session
Position: anchored to right side of result card, flip if near viewport edge
```

**Preview Data API:**

```
GET /api/knowledge/:kbId/pages/:pageId/preview?level=L1&q=keyword

Response:
{
  "pageId": "page-xxx",
  "title": "案件基本情况",
  "level": "L1",
  "size": "5.8KB",
  "snippet": "...highlighted content...",
  "uploadDate": "2024-01-15"
}
```

**Files to create:**

- Create `frontend/src/components/search/PreviewCard.tsx` -- hover preview component

### B.3 Per-Document Level Switching (NEW)

**Requirement:** Each document can be viewed at L0/L1/L2 by selecting the level on the document itself. The LevelSwitcher component is reused across search results, Wiki browsing, and document detail views.

**Level Switcher Component:**

- Tab-style buttons: `L0 摘要` | `L1 概述` | `L2 原文`
- Active tab highlighted in blue
- Clicking a tab loads that level's content without page refresh
- Keywords remain highlighted across level switches
- Remember user's preferred default level (stored in localStorage under `deepanalyze-default-level`)

**Level Switcher Component Props:**

```typescript
interface LevelSwitcherProps {
  pageId: string
  kbId: string
  currentLevel: "L0" | "L1" | "L2"
  availableLevels: Array<"L0" | "L1" | "L2">
  onLevelChange: (level: "L0" | "L1" | "L2") => void
  keywords?: string[]  // for maintaining highlights across switches
}
```

**API:**

```
GET /api/knowledge/:kbId/pages/:pageId?level=L1

Response:
{
  "pageId": "page-xxx",
  "docId": "doc-xxx",
  "title": "案件基本情况",
  "level": "L1",
  "content": "...",
  "availableLevels": ["L0", "L1", "L2"],
  "levelMeta": {
    "L0": { "size": "2.1KB", "generated": true },
    "L1": { "size": "5.8KB", "generated": true },
    "L2": { "size": "12.4KB", "generated": false }
  },
  "entities": [...],
  "links": [...]
}
```

**Level descriptions:**

| Level | Size | Description |
|-------|------|-------------|
| L0 摘要 | ~200-500 chars | AI-generated abstract, quick overview |
| L1 概述 | ~500-2000 chars | AI-generated structured overview, sections |
| L2 原文 | Full document | Original uploaded document, complete |

**Files to create/modify:**

- Create `frontend/src/components/search/LevelSwitcher.tsx` -- reusable level switching component
- Modify `src/server/routes/knowledge.ts` -- add level parameter to page API
- Modify `frontend/src/components/knowledge/KnowledgePanel.tsx` -- integrate LevelSwitcher in Wiki view
- Modify `frontend/src/components/search/UnifiedSearch.tsx` -- integrate LevelSwitcher in search results

### B.4 Module Integration -- Three-in-One

**Current:** 3 separate modules (Search, Wiki, Preview) -- clicking search results can't preview, Wiki is disconnected.

**After:** Unified Knowledge Panel:

- Top: Unified search bar (always visible)
- Results: Level-grouped results with hover preview
- Wiki browsing: Expandable section below search, linked from search results
- Entity cards: Shown alongside search results

**Unified Knowledge Panel Layout:**

```
+--------------------------------------------------+
| [Search bar: Search across all levels...]   [?]  |
+--------------------------------------------------+
| L0 (3)  |  L1 (7)  |  L2 (9)  |  Entities (4)   |
+--------------------------------------------------+
|                                                    |
|  Result Card 1                     [Preview ->]   |
|  +----------------------------------------------+ |
|  | 案件基本情况                    L1 概述        | |
|  | ...夏某某在2023年3月期间...                    | |
|  | Source: doc-001 | 5.8KB                       | |
|  +----------------------------------------------+ |
|                                                    |
|  Result Card 2                     [Preview ->]   |
|  +----------------------------------------------+ |
|  | 资金往来记录                    L2 原文        | |
|  | ...经查明，夏某某与张某存在...                 | |
|  | Source: doc-002 | 12.4KB                      | |
|  +----------------------------------------------+ |
|                                                    |
|  --- Wiki Browsing (expandable) ---                |
|  [Expand to browse full knowledge base wiki]       |
|                                                    |
+--------------------------------------------------+
```

**Files to modify:**

- Modify `frontend/src/components/knowledge/KnowledgePanel.tsx` -- restructure to unified layout

---

## Module C: Report + Chat Integration

### C.1 Reports Embedded in Chat

**Problem:** Agent generates report but it doesn't appear in chat window. Reports go to separate panel. Agent doesn't know about its own reports.

**Solution:** Reports render as rich cards directly in the chat message flow.

**Report Card in Chat:**

- Header (gradient blue): title, generation time, document count, reference count, download/copy buttons
- Body: clean Markdown content with reference markers [n] and entity links (dashed underline)
- Footer: reference count, "View full report" link
- Below card: Agent summary text (1-2 sentence summary with key findings)

**Report Card Visual Layout:**

```
+----------------------------------------------------------+
|  案件综合分析报告              2024-01-15 14:32  [>] [copy] |
|  3 documents | 12 references | [download PDF]             |
+----------------------------------------------------------+
|                                                            |
|  ## 核心发现                                               |
|                                                            |
|  夏某某涉嫌非法经营案涉及金额达500万元[n1]。              |
|  根据银行流水记录，资金主要通过三个账户流转[n2]。         |
|                                                            |
|  ## 关键人物                                               |
|                                                            |
|  夏某某 作为核心嫌疑人，与张某[n3]存在密切资金往来。     |
|  李某某 作为中间人，参与了资金的[部分操作]。               |
|                                                            |
+----------------------------------------------------------+
|  12 references  |  View full report ->                     |
+----------------------------------------------------------+
|  Agent: 本报告分析了3份核心文档，发现夏某某涉案金额       |
|  达500万元，涉及3个银行账户的资金流转。关键证据集中在     |
|  银行流水记录中。                                          |
+----------------------------------------------------------+
```

**Chat Message Type Extension:**

```typescript
// Extend existing chat message types
interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: string
  // New field for embedded reports
  report?: {
    id: string
    title: string
    summary: string  // Agent's 1-2 sentence summary
  }
}
```

**Files to create/modify:**

- Create `frontend/src/components/chat/ReportCard.tsx` -- embedded report component
- Modify `frontend/src/components/ChatWindow.tsx` -- render ReportCard for report messages
- Modify `src/server/routes/chat.ts` -- return report data inline with chat messages

### C.2 Reference Markers + Hover Preview

**Problem:** Reports filled with raw source blocks like "From: Overview: xxx" instead of clean analysis.

**Solution:** Clean reference system with interactive markers.

**Reference Marker Types:**

| Type | Style | Behavior |
|------|-------|----------|
| Document reference [n] | Blue superscript badge | Hover: shows source document snippet with keyword highlight |
| Entity link | Dashed blue underline | Hover: shows entity type + occurrence count |
| Data highlight | Yellow background | Visual emphasis for key figures |

**Reference Marker Hover Detail:**

```
[n1] hover popup:
+-------------------------------------------+
| 来源: 银行流水记录.pdf                    |
| Level: L1 概述                            |
+-------------------------------------------+
| ...夏某某在2023年3月期间，通过其控制的     |
| 多个银行账户进行资金往来，总金额达         |
| 500万元...                                 |
+-------------------------------------------+
| [Open source document ->]                  |
+-------------------------------------------+
```

**Entity Link Hover Detail:**

```
张某 hover popup:
+-------------------------------------------+
| Entity: Person                            |
| Occurrences: 23 across 5 documents        |
| Type: 自然人                              |
+-------------------------------------------+
| [View all mentions ->]                     |
+-------------------------------------------+
```

**De-noising Pipeline:**

Agent raw output -> Content cleaning (remove "From: ..." blocks) -> Reference marking (raw quotes -> [n] markers linked to source docs) -> Clean report

**De-noising Pipeline Detail:**

```
Stage 1: Content Cleaning
  - Remove "From: Overview: xxx" blocks
  - Remove "From: Summary: xxx" blocks
  - Remove "Based on the document..." prefixes
  - Remove raw tool output formatting
  - Preserve actual analysis and conclusions

Stage 2: Reference Marking
  - Identify quoted passages from source documents
  - Replace with [n] markers
  - Build reference index linking each [n] to source doc + page + level

Stage 3: Entity Linking
  - Identify entity mentions (persons, organizations, amounts, dates)
  - Wrap in entity link markup
  - Link to entity database for hover preview

Stage 4: Final Cleanup
  - Normalize Markdown formatting
  - Ensure heading hierarchy is consistent
  - Remove duplicate whitespace
```

**Content Cleaner Implementation Approach:**

```typescript
// src/services/report/cleaner.ts

interface CleanResult {
  cleanContent: string        // Markdown with [n] markers and entity links
  references: Reference[]     // Extracted reference data
  entities: string[]          // Identified entities
  stats: {
    originalLength: number
    cleanLength: number
    referencesExtracted: number
    entitiesLinked: number
    blocksRemoved: number
  }
}

function cleanReport(rawContent: string, sourceDocuments: Document[]): CleanResult
```

**Files to create/modify:**

- Create `frontend/src/components/chat/ReferenceMarker.tsx` -- [n] marker with hover
- Create `frontend/src/components/chat/EntityLink.tsx` -- entity link with hover
- Create `src/services/report/cleaner.ts` -- de-noising pipeline
- Modify `src/services/agent/tools/report-generate.ts` -- produce clean output with reference markers

### C.3 Report Data Structure

```typescript
interface Report {
  id: string;
  sessionId: string;
  messageId: string;          // linked to chat message
  title: string;
  cleanContent: string;       // cleaned Markdown
  rawContent: string;         // agent raw output (archive)
  references: Array<{
    id: number;
    docId: string;
    pageId: string;
    title: string;
    level: "L0" | "L1" | "L2";
    snippet: string;
    highlight: string;
  }>;
  entities: string[];
  createdAt: string;
}
```

**Report Storage Schema (SQLite):**

```sql
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  title TEXT NOT NULL,
  clean_content TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  entities TEXT, -- JSON array of entity names
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE report_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  ref_index INTEGER NOT NULL, -- the [n] number
  doc_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('L0', 'L1', 'L2')),
  snippet TEXT NOT NULL,
  highlight TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX idx_reports_session ON reports(session_id);
CREATE INDEX idx_reports_message ON reports(message_id);
CREATE INDEX idx_report_refs_report ON report_references(report_id);
```

**Report API Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/reports` | List all reports (paginated) |
| GET | `/api/reports/:id` | Get single report with references |
| GET | `/api/sessions/:sessionId/reports` | Get reports for a session |
| DELETE | `/api/reports/:id` | Delete a report |
| GET | `/api/reports/:id/export` | Export report as PDF/Markdown |

**Files to create/modify:**

- Create `src/store/reports.ts` -- report persistence (SQLite)
- Modify `src/server/routes/reports.ts` -- CRUD API for reports

---

## Module D: Multi-Agent System (v2 -- AgentTeams Integration)

### D.1 Three-Layer Architecture

**Bottom Layer -- Core Agent Capability (existing, preserved):**

- AgentRunner: TAOR loop, context management, tool execution, session memory
- Orchestrator: runSingle, runParallel, runCoordinated
- Swarm: process-level isolation, teammate spawning (for advanced scenarios)

**Middle Layer -- Scheduling Engine (new, ported from CountBot):**

- WorkflowEngine with 4 scheduling modes
- Pipeline, Graph (DAG), Council, Parallel

**Top Layer -- Entry Points (4 ways to trigger multi-agent):**

1. User-specified: `@team_name goal` mention or `/team` command in chat
2. Skills-driven: Skill definitions include scheduling suggestions, Agent decides whether to adopt
3. Agent-autonomous: Agent uses `workflow_run` tool to create sub-agents on demand
4. Plugin-registered: Plugins register custom Agent teams and scheduling strategies

**Architecture Diagram:**

```
+-------------------------------------------------------------------+
|                        Entry Points                                |
|  User Command  |  Skill Suggestion  |  Agent Tool  |  Plugin      |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|                    WorkflowEngine (new)                            |
|  Pipeline  |  Graph (DAG)  |  Council  |  Parallel               |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|                  Existing Core (preserved)                        |
|  AgentRunner  |  Orchestrator  |  Swarm  |  ToolRegistry         |
+-------------------------------------------------------------------+
```

### D.2 Scheduling Modes

**Pipeline Mode:**

- Sequential stages with accumulated context
- Each stage receives all prior outputs
- Use case: Research -> Organize -> Analyze -> Report

**Pipeline Mode Detail:**

```
Input: { goal: "Analyze case documents", stages: [...] }

Stage 1 (Research Agent):
  input: goal
  output: { findings: [...], documents: [...] }

Stage 2 (Organize Agent):
  input: goal + Stage 1 output
  output: { organizedData: {...}, categories: [...] }

Stage 3 (Analyze Agent):
  input: goal + Stage 1 + Stage 2 output
  output: { analysis: {...], keyPoints: [...] }

Stage 4 (Report Agent):
  input: goal + all prior outputs
  output: { report: "...", references: [...] }

Final: Combined output returned to caller
```

**Graph (DAG) Mode:**

- Dependency-based scheduling with automatic parallelism
- Ready nodes (all dependencies met) run in parallel via Promise.allSettled
- Condition evaluation: skip nodes whose conditions fail
- Failure propagation: downstream nodes marked as FAILED when upstream fails
- Cycle detection via DFS
- Use case: 3 research agents in parallel -> analysis -> report

**Graph (DAG) Mode Detail:**

```
Input: {
  nodes: [
    { id: "research-1", task: "Research bank records", dependsOn: [] },
    { id: "research-2", task: "Research witness statements", dependsOn: [] },
    { id: "research-3", task: "Research evidence chain", dependsOn: [] },
    { id: "analyze", task: "Analyze all findings", dependsOn: ["research-1", "research-2", "research-3"] },
    { id: "report", task: "Generate final report", dependsOn: ["analyze"] },
    { id: "optional-review", task: "Legal review", dependsOn: ["report"],
      condition: { type: "output_contains", node: "analyze", text: "legal" }
    }
  ]
}

Execution:
  Round 1: research-1, research-2, research-3 run in parallel
  Round 2: analyze runs (all 3 research complete)
  Round 3: report runs (analyze complete)
  Round 4: optional-review runs only if analyze output contains "legal"
```

**Condition Evaluation:**

```typescript
type Condition = {
  type: "output_contains" | "output_not_contains"
  node: string    // which upstream node's output to check
  text: string    // text to search for
}

function evaluateCondition(condition: Condition, nodeOutputs: Map<string, any>): boolean {
  const output = nodeOutputs.get(condition.node)
  const outputText = JSON.stringify(output)
  if (condition.type === "output_contains") {
    return outputText.includes(condition.text)
  }
  return !outputText.includes(condition.text)
}
```

**Cycle Detection (DFS):**

```typescript
function detectCycle(nodes: DAGNode[]): string[] | null {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const path: string[] = []

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    recursionStack.add(nodeId)
    path.push(nodeId)

    const node = nodes.find(n => n.id === nodeId)
    for (const dep of node?.dependsOn ?? []) {
      if (!visited.has(dep)) {
        if (dfs(dep)) return true
      } else if (recursionStack.has(dep)) {
        path.push(dep)
        return true // cycle found
      }
    }

    recursionStack.delete(nodeId)
    path.pop()
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return path // return cycle path
    }
  }
  return null // no cycle
}
```

**Council Mode:**

- Round 1: All members analyze from their specific perspective (parallel)
- Round 2 (optional cross-review): Each member reviews others' positions and refines
- Use case: Legal perspective + Financial perspective + Evidence perspective with cross-review

**Council Mode Detail:**

```
Input: {
  goal: "Evaluate case strength",
  members: [
    { role: "Legal Analyst", perspective: "legal" },
    { role: "Financial Analyst", perspective: "financial" },
    { role: "Evidence Analyst", perspective: "evidence" }
  ],
  crossReview: true
}

Round 1 (Parallel):
  Legal Analyst:   "From legal perspective, the case has strong grounds for..."
  Financial Analyst: "From financial perspective, the money trail shows..."
  Evidence Analyst:  "From evidence perspective, the chain of custody is..."

Round 2 (Cross-Review, if enabled):
  Legal Analyst reviews Financial + Evidence positions:
    "Considering the financial analysis and evidence analysis, the legal
     position is strengthened by..."
  Financial Analyst reviews Legal + Evidence positions:
    "The legal findings confirm the financial anomalies identified..."
  Evidence Analyst reviews Legal + Financial positions:
    "The evidence supports both legal and financial conclusions..."

Synthesis: Combined report with all perspectives and cross-references
```

**Parallel Mode:**

- Enhanced version of existing Orchestrator.runParallel
- Coordinator auto-decomposes task, runs sub-tasks in parallel, synthesizes results
- Use case: Agent discovers 5 documents to read -> spawns 5 parallel research agents

**Parallel Mode Detail:**

```
Input: { goal: "Research all 5 case documents" }

Decomposition (automatic):
  Sub-task 1: "Research document 1 - 银行流水"
  Sub-task 2: "Research document 2 - 证人证言"
  Sub-task 3: "Research document 3 - 合同副本"
  Sub-task 4: "Research document 4 - 通讯记录"
  Sub-task 5: "Research document 5 - 审计报告"

Execution: All 5 sub-agents run in parallel

Synthesis: Combine results into unified research summary
  - Key findings from each document
  - Cross-references between documents
  - Outstanding questions
```

### D.3 Agent Team Data Model

```typescript
interface AgentTeam {
  id: string;
  name: string;
  description: string;
  mode: "pipeline" | "graph" | "council" | "parallel";
  agents: Array<{
    id: string;
    role: string;
    systemPrompt?: string;
    task: string;
    perspective?: string;     // council only
    dependsOn: string[];      // graph only
    condition?: {             // graph only
      type: "output_contains" | "output_not_contains";
      node: string;
      text: string;
    };
    tools: string[];
  }>;
  isActive: boolean;
  crossReview: boolean;       // council only
  enableSkills: boolean;
  modelConfig?: {             // optional model override
    provider?: string;
    model?: string;
    temperature?: number;
  };
}
```

**Agent Team SQLite Schema:**

```sql
CREATE TABLE agent_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('pipeline', 'graph', 'council', 'parallel')),
  is_active INTEGER NOT NULL DEFAULT 1,
  cross_review INTEGER NOT NULL DEFAULT 0,
  enable_skills INTEGER NOT NULL DEFAULT 0,
  model_config TEXT, -- JSON object
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agent_team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT,
  task TEXT NOT NULL,
  perspective TEXT,
  depends_on TEXT, -- JSON array of member IDs
  condition_config TEXT, -- JSON object
  tools TEXT NOT NULL, -- JSON array of tool names
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (team_id) REFERENCES agent_teams(id) ON DELETE CASCADE
);

CREATE INDEX idx_team_members_team ON agent_team_members(team_id);
```

**REST API:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agent-teams` | List all teams |
| GET | `/api/agent-teams/:id` | Get team |
| POST | `/api/agent-teams` | Create team |
| PUT | `/api/agent-teams/:id` | Update team |
| DELETE | `/api/agent-teams/:id` | Delete team |

### D.4 workflow_run Tool

A new tool registered in ToolRegistry that allows any Agent to create and run multi-agent workflows:

```typescript
{
  name: "workflow_run",
  description: "Create and execute a multi-agent workflow. Specify pipeline/graph/council mode or let the system auto-select.",
  inputSchema: {
    teamName: { type: "string", description: "Existing team name to use (optional)" },
    mode: { type: "string", enum: ["pipeline", "graph", "council", "parallel"] },
    goal: { type: "string", description: "Workflow goal" },
    agents: [{
      id: "string",
      role: "string",
      task: "string",
      dependsOn: { type: "array", items: "string" },
      tools: { type: "array", items: "string" }
    }]
  }
}
```

**Agent invocation flow:**

1. Agent decides task is complex -> calls workflow_run
2. WorkflowEngine creates sub-agents via SubAgentManager
3. Each sub-agent runs via existing AgentRunner.run()
4. WebSocket events stream to frontend: workflow_agent_start, workflow_agent_tool_call, workflow_agent_tool_result, workflow_agent_chunk, workflow_agent_complete
5. Results aggregated and returned to calling Agent

**WebSocket Event Types:**

| Event | Payload | Description |
|-------|---------|-------------|
| `workflow_start` | `{ workflowId, teamName, mode, agentCount }` | Workflow begins |
| `workflow_agent_start` | `{ workflowId, agentId, role, task }` | Sub-agent starts |
| `workflow_agent_tool_call` | `{ workflowId, agentId, tool, args }` | Sub-agent calls tool |
| `workflow_agent_tool_result` | `{ workflowId, agentId, tool, result }` | Tool returns result |
| `workflow_agent_chunk` | `{ workflowId, agentId, chunk }` | Streaming text from sub-agent |
| `workflow_agent_complete` | `{ workflowId, agentId, status, duration }` | Sub-agent finishes |
| `workflow_complete` | `{ workflowId, status, totalDuration, resultCount }` | Workflow finishes |

**workflow_run Tool Implementation Approach:**

```typescript
// src/services/agent/tools/workflow-run.ts

async function executeWorkflowRun(input: WorkflowRunInput, context: AgentContext) {
  const workflowId = generateId()

  // Determine team and mode
  const team = input.teamName
    ? await teamManager.getByName(input.teamName)
    : buildAdHocTeam(input)

  const mode = input.mode || team.mode

  // Emit start event
  context.emit("workflow_start", { workflowId, teamName: team.name, mode, agentCount: team.agents.length })

  // Execute via WorkflowEngine
  const engine = new WorkflowEngine(team, context)
  const results = await engine.execute(mode)

  // Aggregate results
  return {
    workflowId,
    mode,
    agentResults: results.map(r => ({
      agentId: r.agentId,
      role: r.role,
      status: r.status,
      output: r.output
    })),
    synthesis: synthesizeResults(results)
  }
}
```

### D.5 Frontend Real-Time Visualization

**SubAgentPanel Component:**

- Shows when a workflow is running
- Grid of Agent cards, each showing:
  - Status dot (color-coded, pulsing animation for running)
  - Agent role and task description
  - Tool call count badge
  - Status label: queued / running / waiting / completed / error
  - Duration display
  - Progress bar (animated)
  - Scrollable message area with:
    - Tool call cards (collapsible, shows arguments and result)
    - Streaming assistant text
    - System messages

**SubAgentPanel Layout:**

```
+----------------------------------------------------------+
|  Workflow: Case Analysis          Pipeline Mode    [x]    |
|  4 agents | 2 completed | 1 running | ETA ~30s           |
+----------------------------------------------------------+
|                                                            |
|  +-----------------------+  +-----------------------+     |
|  | [o] Research Agent    |  | [o] Organize Agent    |     |
|  | Status: COMPLETED     |  | Status: COMPLETED     |     |
|  | Duration: 12.3s       |  | Duration: 8.7s        |     |
|  | Tools: 3 calls        |  | Tools: 2 calls        |     |
|  | [========100%]        |  | [========100%]        |     |
|  +-----------------------+  +-----------------------+     |
|                                                            |
|  +-----------------------+  +-----------------------+     |
|  | [*] Analyze Agent     |  | [ ] Report Agent      |     |
|  | Status: RUNNING       |  | Status: QUEUED        |     |
|  | Duration: 5.2s...     |  | Duration: --          |     |
|  | Tools: 1 call         |  | Tools: 0 calls        |     |
|  | [=====   60%]         |  | [        0%]          |     |
|  |                        |  |                       |     |
|  | > kb_search("夏某某")  |  |                       |     |
|  |   Found 15 results     |  |                       |     |
|  | > Analyzing findings.. |  |                       |     |
|  +-----------------------+  +-----------------------+     |
|                                                            |
+----------------------------------------------------------+
```

**Status Colors:**

| Status | Dot Color | Animation |
|--------|-----------|-----------|
| Queued | Gray | None |
| Running | Green | Pulsing |
| Waiting | Yellow | Slow pulse |
| Completed | Blue | None |
| Error | Red | None |

**SubAgentSlot (Individual Agent Card) Props:**

```typescript
interface SubAgentSlotProps {
  agentId: string
  role: string
  task: string
  status: "queued" | "running" | "waiting" | "completed" | "error"
  duration: number
  toolCallCount: number
  progress: number  // 0-100
  messages: Array<{
    type: "tool_call" | "tool_result" | "assistant_chunk" | "system"
    content: string
    expanded?: boolean
  }>
}
```

**TeamManager Component:**

- List of teams as cards with mode badges
- CRUD operations: create, edit, delete, toggle active
- Template presets for common patterns

**TeamManager Layout:**

```
+----------------------------------------------------------+
|  Agent Teams                              [+ New Team]    |
+----------------------------------------------------------+
|                                                            |
|  +------------------------------------------------------+ |
|  | Case Analysis Team                    Pipeline  [ON]  | |
|  | Research -> Organize -> Analyze -> Report             | |
|  | 4 agents | Last used: 2024-01-15                      | |
|  | [Edit] [Duplicate] [Delete]                           | |
|  +------------------------------------------------------+ |
|                                                            |
|  +------------------------------------------------------+ |
|  | Multi-Perspective Review              Council  [ON]   | |
|  | Legal + Financial + Evidence perspectives             | |
|  | 3 agents | Last used: 2024-01-14                      | |
|  | [Edit] [Duplicate] [Delete]                           | |
|  +------------------------------------------------------+ |
|                                                            |
+----------------------------------------------------------+
```

**Team Preset Templates:**

| Template | Mode | Agents | Use Case |
|----------|------|--------|----------|
| Research Pipeline | Pipeline | Research + Organize + Report | General document research |
| Multi-Perspective | Council | 3 perspective agents | Balanced analysis |
| Parallel Research | Parallel | N research agents | Fast document scanning |
| Full Analysis | Graph | 3 research + analysis + report | Complex case analysis |

**TeamEditor Component:**

- Modal for creating/editing teams
- Mode selection dropdown
- Per-member configuration: ID, role, task, dependencies, tools
- Visual dependency preview

**TeamEditor Layout:**

```
+----------------------------------------------------------+
|  Create Team                                              |
+----------------------------------------------------------+
|                                                            |
|  Name: [Case Analysis Team          ]                     |
|  Description: [Full case analysis pipeline...]            |
|  Mode: [Pipeline v]                                       |
|                                                            |
|  --- Agents ---                                            |
|                                                            |
|  Agent 1:                                                  |
|    Role: [Researcher        ]                              |
|    Task: [Research all case documents]                     |
|    Tools: [kb_search, wiki_browse, expand]                 |
|                                                            |
|  Agent 2:                                                  |
|    Role: [Organizer         ]                              |
|    Task: [Organize findings into categories]               |
|    Tools: [kb_search]                                      |
|                                                            |
|  [+ Add Agent]                                             |
|                                                            |
|  --- Dependency Preview (Graph mode only) ---              |
|                                                            |
|    [Research-1] ---> [Analyze] ---> [Report]               |
|    [Research-2] --/                                     |
|    [Research-3] --/                                     |
|                                                            |
+----------------------------------------------------------+
|  [Cancel]                              [Save Team]        |
+----------------------------------------------------------+
```

**WorkflowStore (Zustand):**

```typescript
interface WorkflowState {
  // Active workflow
  activeWorkflows: Map<string, {
    workflowId: string
    teamName: string
    mode: string
    startedAt: string
    agents: Map<string, {
      agentId: string
      role: string
      task: string
      status: "queued" | "running" | "waiting" | "completed" | "error"
      duration: number
      toolCallCount: number
      progress: number
      messages: any[]
    }>
  }>

  // Event handlers
  handleWorkflowStart: (event: any) => void
  handleAgentStart: (event: any) => void
  handleAgentToolCall: (event: any) => void
  handleAgentToolResult: (event: any) => void
  handleAgentChunk: (event: any) => void
  handleAgentComplete: (event: any) => void
  handleWorkflowComplete: (event: any) => void

  // Actions
  clearWorkflow: (workflowId: string) => void
}
```

**Files to create:**

- Create `src/services/agent/workflow-engine.ts` -- WorkflowEngine with 4 modes
- Create `src/services/agent/agent-team-manager.ts` -- Team CRUD + persistence
- Create `src/store/agent-teams.ts` -- SQLite persistence for teams
- Create `src/server/routes/agent-teams.ts` -- REST API routes
- Create `frontend/src/components/teams/SubAgentPanel.tsx` -- live workflow display
- Create `frontend/src/components/teams/SubAgentSlot.tsx` -- individual agent card
- Create `frontend/src/components/teams/TeamManager.tsx` -- team CRUD UI
- Create `frontend/src/components/teams/TeamEditor.tsx` -- team creation/editing
- Create `frontend/src/store/workflow.ts` -- Zustand store for workflow state
- Create `frontend/src/api/agentTeams.ts` -- API client for teams

**Files to modify:**

- Modify `src/services/agent/tool-setup.ts` -- register workflow_run tool
- Modify `src/services/agent/agent-system.ts` -- initialize WorkflowEngine and AgentTeamManager
- Modify `src/server/app.ts` -- mount agent-teams routes
- Modify `src/ws/handler.ts` -- handle workflow_* WebSocket events
- Modify `frontend/src/store/chat.ts` -- integrate workflow events
- Modify `frontend/src/components/ChatWindow.tsx` -- show SubAgentPanel when workflow active
- Modify `src/services/plugins/plugin-manager.ts` -- support team scheduling strategies from plugins
- Extend `SkillDefinition` type -- add optional `scheduling` field for multi-agent suggestions

### D.6 Integration with Existing System

**What is preserved (no changes):**

- AgentRunner.run() -- core execution loop unchanged
- ToolRegistry -- all existing tools preserved
- Orchestrator.runSingle/runParallel/runCoordinated -- kept as alternative dispatch paths
- PluginManager -- extended but backward compatible
- Session memory, compaction, auto-dream -- all preserved

**What is new:**

- WorkflowEngine sits between Orchestrator and AgentRunner as a new scheduling layer
- workflow_run tool gives Agents the ability to self-organize
- AgentTeamManager provides persistent team templates
- Frontend components provide real-time visibility

**Call chain:**

```
User/Skill/Agent -> workflow_run tool -> WorkflowEngine -> SubAgentManager -> AgentRunner.run()
```

**Detailed Call Chain:**

```
1. User types "@case-analysis-team Analyze the case"
   OR Agent autonomously decides to call workflow_run
   OR Skill triggers workflow

2. workflow_run tool receives input

3. WorkflowEngine created with team definition
   - If teamName provided, load from AgentTeamManager (SQLite)
   - If agents array provided, create ad-hoc team
   - Determine mode (pipeline/graph/council/parallel)

4. WorkflowEngine.execute() called
   - Pipeline: run agents sequentially, accumulate context
   - Graph: build DAG, run ready nodes in parallel, propagate results
   - Council: run all members in parallel, optional cross-review round
   - Parallel: decompose task, run all sub-tasks in parallel, synthesize

5. For each sub-agent:
   - SubAgentManager creates new AgentRunner instance
   - AgentRunner.run() called with task + context + tools
   - Events emitted via onEvent callback

6. Events flow to frontend:
   - AgentRunner.onEvent -> WebSocket.emit -> Frontend WorkflowStore -> SubAgentPanel re-render

7. Results aggregated:
   - All sub-agent outputs collected
   - Synthesis performed (mode-specific)
   - Result returned to calling Agent
   - Calling Agent continues with workflow results
```

**Event chain:**

```
AgentRunner -> onEvent callback -> WebSocket -> Frontend WorkflowStore -> SubAgentPanel update
```

**Backward Compatibility Notes:**

- All existing single-agent workflows continue to work without any changes
- Orchestrator methods remain available for code that uses them directly
- Plugin APIs are extended (not replaced) -- existing plugins work unchanged
- The workflow_run tool is optional -- Agents that don't need multi-agent never use it
- Frontend gracefully handles absence of workflow events (SubAgentPanel only shows when active)

---

## Implementation Priority

| Priority | Module | Rationale |
|----------|--------|-----------|
| P0 | Module A (Upload + Persistence) | Foundation: upload and state are prerequisites |
| P1 | Module B (Unified Search) | Core interaction: search is the primary knowledge discovery tool |
| P2 | Module C (Report + Chat) | Depends on B: references need search for source preview |
| P3 | Module D (Multi-Agent) | Most complex: requires stable foundation from A+B+C |

**Estimated Effort by Module:**

| Module | New Files | Modified Files | Estimated Effort |
|--------|-----------|----------------|------------------|
| A (Upload + Persistence) | 1 | 5 | 3-4 days |
| B (Unified Search) | 4 | 4 | 4-5 days |
| C (Report + Chat) | 5 | 3 | 3-4 days |
| D (Multi-Agent) | 10 | 7 | 7-10 days |
| **Total** | **21** | **17** | **17-23 days** |

---

## Cross-Module Dependencies

- Module C's reference preview depends on Module B's search API
- Module D's workflow_run can use all existing tools including those from B (kb_search, wiki_browse, expand)
- Module A's URL routing affects how all views are accessed
- Module B's LevelSwitcher is used in both search results and Wiki browsing (Module A's Knowledge panel)

**Dependency Graph:**

```
Module A (Upload + Persistence)
    |
    v
Module B (Unified Search)
    |       \
    v        v
Module C (Report + Chat)    Module D (Multi-Agent)
    |                              |
    +-- C depends on B -----------+
    +-- D uses B's tools ---------+
    +-- D uses A's routing -------+
```

---

## Complete File Manifest

### New Files to Create (21 files)

| # | File Path | Module | Purpose |
|---|-----------|--------|---------|
| 1 | `frontend/src/router.tsx` | A | URL routing with react-router |
| 2 | `src/server/routes/search.ts` | B | Unified search endpoint |
| 3 | `frontend/src/components/search/UnifiedSearch.tsx` | B | Search UI with level tabs |
| 4 | `frontend/src/components/search/SearchResultCard.tsx` | B | Individual result card |
| 5 | `frontend/src/components/search/PreviewCard.tsx` | B | Hover preview component |
| 6 | `frontend/src/components/search/LevelSwitcher.tsx` | B | Reusable level switching component |
| 7 | `frontend/src/components/chat/ReportCard.tsx` | C | Embedded report component |
| 8 | `frontend/src/components/chat/ReferenceMarker.tsx` | C | [n] marker with hover |
| 9 | `frontend/src/components/chat/EntityLink.tsx` | C | Entity link with hover |
| 10 | `src/services/report/cleaner.ts` | C | De-noising pipeline |
| 11 | `src/store/reports.ts` | C | Report persistence (SQLite) |
| 12 | `src/services/agent/workflow-engine.ts` | D | WorkflowEngine with 4 modes |
| 13 | `src/services/agent/agent-team-manager.ts` | D | Team CRUD + persistence |
| 14 | `src/store/agent-teams.ts` | D | SQLite persistence for teams |
| 15 | `src/server/routes/agent-teams.ts` | D | REST API routes |
| 16 | `frontend/src/components/teams/SubAgentPanel.tsx` | D | Live workflow display |
| 17 | `frontend/src/components/teams/SubAgentSlot.tsx` | D | Individual agent card |
| 18 | `frontend/src/components/teams/TeamManager.tsx` | D | Team CRUD UI |
| 19 | `frontend/src/components/teams/TeamEditor.tsx` | D | Team creation/editing |
| 20 | `frontend/src/store/workflow.ts` | D | Zustand store for workflow state |
| 21 | `frontend/src/api/agentTeams.ts` | D | API client for teams |

### Existing Files to Modify (17 files)

| # | File Path | Module | Change |
|---|-----------|--------|--------|
| 1 | `frontend/src/components/knowledge/KnowledgePanel.tsx` | A, B | Non-blocking upload, batch ops, unified layout, LevelSwitcher |
| 2 | `frontend/src/api/client.ts` | A | Upload with timeout and retry |
| 3 | `src/server/routes/knowledge.ts` | A, B | Upload acknowledgment, level parameter |
| 4 | `frontend/src/App.tsx` | A | Integrate router |
| 5 | `frontend/src/store/ui.ts` | A | Sync state to localStorage and URL |
| 6 | `frontend/src/store/chat.ts` | A, D | Persist session ID, integrate workflow events |
| 7 | `src/wiki/retriever.ts` | B | Multi-level search with keyword highlighting |
| 8 | `frontend/src/components/ChatWindow.tsx` | C, D | Render ReportCard, show SubAgentPanel |
| 9 | `src/server/routes/chat.ts` | C | Return report data inline with chat messages |
| 10 | `src/services/agent/tools/report-generate.ts` | C | Produce clean output with reference markers |
| 11 | `src/server/routes/reports.ts` | C | CRUD API for reports |
| 12 | `src/services/agent/tool-setup.ts` | D | Register workflow_run tool |
| 13 | `src/services/agent/agent-system.ts` | D | Initialize WorkflowEngine and AgentTeamManager |
| 14 | `src/server/app.ts` | D | Mount agent-teams routes |
| 15 | `src/ws/handler.ts` | D | Handle workflow_* WebSocket events |
| 16 | `src/services/plugins/plugin-manager.ts` | D | Support team scheduling strategies from plugins |
| 17 | `src/services/plugins/types.ts` | D | Extend SkillDefinition with optional `scheduling` field |
