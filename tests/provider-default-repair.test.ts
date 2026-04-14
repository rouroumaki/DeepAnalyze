import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { DB } from "../src/store/database.js";
import { SettingsStore } from "../src/store/settings.js";
import { ModelRouter } from "../src/models/router.js";

describe("provider default repair", () => {
  test("repairs stale defaults.main and keeps ModelRouter runnable", async () => {
    DB.resetInstance();
    const dbPath = `data/test-provider-default-repair-${randomUUID()}.db`;
    const db = DB.getInstance(dbPath);
    db.migrate();

    const store = new SettingsStore();
    store.saveProviderSettings({
      providers: [
        {
          id: "zhipu",
          name: "Zhipu",
          type: "openai-compatible",
          endpoint: "http://localhost:21000/v1",
          apiKey: "",
          model: "glm-4.5",
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

    const repaired = store.getProviderSettings();
    expect(repaired.defaults.main).toBe("zhipu");

    const router = new ModelRouter();
    await router.initialize();
    expect(router.getDefaultModel("main")).toBe("zhipu");
    expect(router.listProviderNames()).toEqual(["zhipu"]);

    DB.resetInstance();
  });
});
