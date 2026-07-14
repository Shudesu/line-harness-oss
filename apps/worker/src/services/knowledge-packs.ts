import * as aiShain from './groq-knowledge-content.js';
import * as soushinSuggest from './soushin-suggest-knowledge-content.js';
import * as henshinHisho from './henshin-hisho-knowledge-content.js';
import { getDefaultProject } from './groq-config.js';

export interface BundledKnowledgePack {
  project: string;
  buildSystemPrompt(kbContext: string): string;
  matchCannedResponse(text: string): string | null;
  getFailClosedEscalationText(): string;
}

const PACKS: Record<string, BundledKnowledgePack> = {
  'ai-shain-link': {
    project: 'ai-shain-link',
    buildSystemPrompt: aiShain.buildSystemPrompt,
    matchCannedResponse: aiShain.matchCannedResponse,
    getFailClosedEscalationText: aiShain.getFailClosedEscalationText,
  },
  'soushin-suggest': {
    project: 'soushin-suggest',
    buildSystemPrompt: soushinSuggest.buildSystemPrompt,
    matchCannedResponse: soushinSuggest.matchCannedResponse,
    getFailClosedEscalationText: soushinSuggest.getFailClosedEscalationText,
  },
  'henshin-hisho': {
    project: 'henshin-hisho',
    buildSystemPrompt: henshinHisho.buildSystemPrompt,
    matchCannedResponse: henshinHisho.matchCannedResponse,
    getFailClosedEscalationText: henshinHisho.getFailClosedEscalationText,
  },
};

/** Returns the bundled pack for `project`, falling back to the default project (fail-closed) if unknown. */
export function getKnowledgePack(project: string): BundledKnowledgePack {
  return PACKS[project] ?? PACKS[getDefaultProject()];
}
