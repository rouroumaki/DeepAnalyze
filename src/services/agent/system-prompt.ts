/**
 * Layered system prompt builder.
 * Separates static sections (cacheable across requests) from
 * dynamic sections (change per request).
 *
 * Reference: refcode/claude-code/src/constants/systemPromptSections.ts
 */

export interface SystemPromptSection {
  name: string;
  content: string;
  isDynamic: boolean;
}

export interface BuiltSystemPrompt {
  full: string;
  staticPart: string;
  dynamicPart: string;
  boundary: string;
}

const DYNAMIC_BOUNDARY = "\n\n---DYNAMIC_BOUNDARY---\n\n";

export class SystemPromptBuilder {
  private sections: SystemPromptSection[] = [];

  addStaticSection(name: string, content: string): this {
    this.sections.push({ name, content, isDynamic: false });
    return this;
  }

  addDynamicSection(name: string, content: string): this {
    this.sections.push({ name, content, isDynamic: true });
    return this;
  }

  build(): BuiltSystemPrompt {
    const staticParts: string[] = [];
    const dynamicParts: string[] = [];

    for (const section of this.sections) {
      if (section.isDynamic) {
        dynamicParts.push(section.content);
      } else {
        staticParts.push(section.content);
      }
    }

    const staticPart = staticParts.join("\n\n");
    const dynamicPart = dynamicParts.join("\n\n");

    let full = staticPart;
    if (dynamicPart) {
      full += DYNAMIC_BOUNDARY + dynamicPart;
    }

    return { full, staticPart, dynamicPart, boundary: DYNAMIC_BOUNDARY };
  }

  reset(): this {
    this.sections = [];
    return this;
  }

  get sectionCount(): number {
    return this.sections.length;
  }

  get dynamicSectionCount(): number {
    return this.sections.filter(s => s.isDynamic).length;
  }
}
