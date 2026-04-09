// =============================================================================
// Migration 004: Add updated_at column to settings and seed default providers
// =============================================================================

import type Database from "better-sqlite3";

export const migration = {
  version: 4,
  name: "settings_upgrade",

  up(db: Database.Database) {
    // Add updated_at column if it doesn't exist (settings table was created
    // in migration 001 without this column)
    const columns = db
      .prepare("PRAGMA table_info(settings)")
      .all() as Array<{ name: string }>;
    const hasUpdatedAt = columns.some((c) => c.name === "updated_at");

    if (!hasUpdatedAt) {
      db.exec(
        "ALTER TABLE settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))"
      );
      console.log("[Migration 004] Added updated_at column to settings");
    }

    // Insert default provider config if no providers setting exists yet
    const defaultProviders = JSON.stringify({
      providers: [
        {
          id: "default",
          name: "Default (OpenAI-Compatible)",
          type: "openai-compatible",
          endpoint: "http://localhost:11434/v1",
          apiKey: "",
          model: "qwen2.5-14b",
          maxTokens: 32768,
          supportsToolUse: true,
          enabled: true,
        },
      ],
      defaults: {
        main: "default",
        summarizer: "",
        embedding: "",
        vlm: "",
      },
    });

    db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('providers', ?)"
    ).run(defaultProviders);

    console.log("[Migration 004] Settings table upgraded");
  },
};
