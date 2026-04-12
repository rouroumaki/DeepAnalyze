# DeepAnalyze

DeepAnalyze is an AI-powered document analysis platform that combines knowledge base management, intelligent agents, and interactive visualizations to deliver deep insights from complex documents.

## Features

- **Knowledge Base Management** — Upload documents (PDF, Word, TXT, Markdown, CSV, etc.), organize them into knowledge bases, and browse structured Wiki content with progressive expansion (L0/L1/L2).
- **AI Agent System** — Multi-turn autonomous agents with tool use, automatic context compaction, session memory, and coordinated multi-agent orchestration.
- **Real-time Chat** — SSE streaming chat with subtask tracking, tool call visualization, and advisory turn limits.
- **Reports & Visualization** — Generate analysis reports, interactive knowledge graphs (force-directed), and chronological timelines from document data.
- **Plugin & Skill System** — Extensible plugin architecture with custom skills, configurable agent settings, and tool registry.
- **Multi-provider LLM Support** — Pluggable provider system supporting OpenAI, Anthropic, Google, local models, and more via configurable endpoints.

## Architecture

```
DeepAnalyze/
├── src/
│   ├── main.ts              # Server entry point
│   ├── server/
│   │   ├── app.ts           # Hono app setup & route mounting
│   │   └── routes/          # API route handlers
│   │       ├── agents.ts    # Agent execution & SSE streaming
│   │       ├── chat.ts      # Chat message handling
│   │       ├── knowledge.ts # Knowledge base & document management
│   │       ├── reports.ts   # Reports, timeline, graph generation
│   │       ├── sessions.ts  # Session CRUD
│   │       ├── settings.ts  # Provider configuration
│   │       └── plugins.ts   # Plugin & skill management
│   ├── services/
│   │   └── agent/           # Agent system core
│   │       ├── agent-runner.ts     # Multi-turn agent loop
│   │       ├── agent-system.ts     # Agent orchestration
│   │       ├── orchestrator.ts     # Coordinated agent workflows
│   │       ├── tool-setup.ts       # Tool registry & setup
│   │       ├── compaction.ts       # Context compaction strategies
│   │       ├── session-memory.ts   # Persistent session memory
│   │       ├── context-manager.ts  # Context window management
│   │       ├── micro-compact.ts    # Incremental compaction
│   │       └── auto-dream.ts       # Background processing
│   └── store/
│       ├── database.ts      # SQLite database with migrations
│       └── settings.ts      # Provider settings persistence
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Root component & view routing
│   │   ├── api/client.ts            # API client with SSE streaming
│   │   ├── components/
│   │   │   ├── chat/ChatWindow.tsx  # Chat interface
│   │   │   ├── knowledge/          # Knowledge base panels
│   │   │   │   ├── KnowledgePanel.tsx  # KB management & file upload
│   │   │   │   ├── WikiBrowser.tsx      # Wiki browsing with expansion
│   │   │   │   ├── EntityPage.tsx       # Entity detail page
│   │   │   │   └── DocumentViewer.tsx   # Document preview
│   │   │   ├── reports/ReportPanel.tsx  # Reports, timeline, graph
│   │   │   ├── settings/SettingsPanel.tsx # Provider & agent config
│   │   │   ├── tasks/TaskPanel.tsx      # Task monitoring
│   │   │   ├── plugins/                # Plugin & skill browser
│   │   │   └── layout/                 # Header, sidebar, app shell
│   │   ├── store/                     # Zustand state management
│   │   ├── hooks/                     # React hooks
│   │   ├── types/                     # TypeScript type definitions
│   │   └── styles/                    # Design tokens & animations
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── start.py                 # Python launcher (start/stop/restart)
├── Dockerfile
├── docker-compose.yml
└── tsconfig.json
```

## Tech Stack

**Backend:**
- [Hono](https://hono.dev/) — Fast web framework
- [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3) — Embedded database
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) — LLM integration
- TypeScript, running via [tsx](https://github.com/privatenumber/tsx)

**Frontend:**
- [React 19](https://react.dev/) — UI framework
- [Zustand](https://zustand.docs.pmnd.rs/) — State management
- [Vite](https://vite.dev/) — Build tooling
- [Marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) — Markdown rendering
- [Lucide React](https://lucide.dev/) — Icons

## Getting Started

### Prerequisites

- Node.js >= 18
- Python 3 (optional, for `start.py` launcher)

### Installation

```bash
# Clone the repository
git clone https://github.com/leotangcw/DeepAnalyze.git
cd DeepAnalyze

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..

# Build frontend for production
cd frontend && npx vite build && cd ..
```

### Configuration

Create a `config/default.json` or set environment variables for your LLM provider:

```json
{
  "providers": {
    "main": {
      "id": "your-provider",
      "name": "Your Provider",
      "apiBase": "https://api.example.com/v1",
      "apiKey": "your-api-key",
      "model": "your-model-name"
    }
  }
}
```

Alternatively, configure providers through the Settings UI after starting the server.

### Running

```bash
# Using Python launcher
python start.py start

# Or directly
npx tsx src/main.ts
```

The server starts on `http://localhost:21000` by default.

### Development

```bash
# Backend with hot reload
npm run dev

# Frontend dev server (in frontend/ directory)
cd frontend && npm run dev
```

## API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/health` | GET | Health check |
| `GET /api/sessions` | GET | List sessions |
| `POST /api/sessions` | POST | Create session |
| `POST /api/chat/send` | POST | Send chat message |
| `POST /api/agents/run-stream` | POST | Run agent with SSE streaming |
| `GET /api/knowledge/kbs` | GET | List knowledge bases |
| `POST /api/knowledge/kbs` | POST | Create knowledge base |
| `POST /api/knowledge/kbs/:id/upload` | POST | Upload document |
| `GET /api/knowledge/:id/wiki/:path` | GET | Browse Wiki content |
| `POST /api/reports/generate` | POST | Generate report |
| `GET /api/settings/providers` | GET | Get provider settings |
| `GET /api/plugins/plugins` | GET | List plugins |
| `GET /api/plugins/skills` | GET | List skills |

## License

MIT

## Contributors

- **leotangcw** — Project creator & maintainer
- **Claude Code** — AI-assisted development (Anthropic Claude Opus 4.6)
