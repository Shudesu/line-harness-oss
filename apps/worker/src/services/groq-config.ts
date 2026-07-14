import botConfigJson from '../../../../bot.config.json';

export interface BotLlmConfig {
  provider: 'groq';
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  dailyCallBudget: number;
}

export interface BotCacheConfig {
  enabled: boolean;
  ttlHours: number;
}

export interface BotRetrievalConfig {
  topK: number;
  minScore: number;
}

export interface BotProjectEntry {
  knowledgePack: string;
}

export interface BotConfig {
  /** @deprecated use defaultProject. Kept for callers that still read `.project`. */
  project: string;
  defaultProject: string;
  projects: Record<string, BotProjectEntry>;
  llm: BotLlmConfig;
  cache: BotCacheConfig;
  retrieval: BotRetrievalConfig;
}

type RawBotConfig = {
  // Legacy single-project shape.
  project?: string;
  knowledgePack?: string;
  // New multi-project shape.
  defaultProject?: string;
  projects?: Record<string, BotProjectEntry>;
  llm: BotLlmConfig;
  cache?: Partial<BotCacheConfig>;
  retrieval?: Partial<BotRetrievalConfig>;
};

/** Runtime defaults from bot.config.json (project-specific values live there, not in code). */
export function getBotConfig(): BotConfig {
  const raw = botConfigJson as RawBotConfig;

  const defaultProject = raw.defaultProject ?? raw.project ?? '';
  const projects: Record<string, BotProjectEntry> =
    raw.projects ??
    (raw.knowledgePack ? { [defaultProject]: { knowledgePack: raw.knowledgePack } } : {});

  return {
    project: defaultProject,
    defaultProject,
    projects,
    llm: raw.llm,
    cache: {
      enabled: raw.cache?.enabled ?? true,
      ttlHours: raw.cache?.ttlHours ?? 72,
    },
    retrieval: {
      topK: raw.retrieval?.topK ?? 3,
      minScore: raw.retrieval?.minScore ?? 0,
    },
  };
}

/** The project used when a friend has no resolvable project (fail-closed default). */
export function getDefaultProject(): string {
  return getBotConfig().defaultProject;
}

/** Whether `project` is a configured project id (used for fail-closed fallback checks). */
export function isKnownProject(project: string): boolean {
  return project in getBotConfig().projects;
}
