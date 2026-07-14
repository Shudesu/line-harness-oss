import { describe, expect, it, vi } from 'vitest';
import { resolveBotProject } from './bot-project.js';

vi.mock('@line-crm/db', () => ({
  getEntryRouteByRefCode: vi.fn(),
}));

vi.mock('./groq-config.js', () => ({
  getBotConfig: () => ({ defaultProject: 'ai-shain-link' }),
  isKnownProject: (project: string) => ['ai-shain-link', 'soushin-suggest', 'henshin-hisho'].includes(project),
}));

const { getEntryRouteByRefCode } = await import('@line-crm/db');

describe('resolveBotProject', () => {
  it('falls back to defaultProject when friend has no ref_code', async () => {
    const project = await resolveBotProject({} as D1Database, { ref_code: null });
    expect(project).toBe('ai-shain-link');
  });

  it('falls back to defaultProject when entry_routes has no matching row', async () => {
    vi.mocked(getEntryRouteByRefCode).mockResolvedValueOnce(null);
    const project = await resolveBotProject({} as D1Database, { ref_code: 'unknown-ref' });
    expect(project).toBe('ai-shain-link');
  });

  it('falls back to defaultProject when entry_routes row has project=NULL', async () => {
    vi.mocked(getEntryRouteByRefCode).mockResolvedValueOnce({ ref_code: 'legacy-ref', project: null } as any);
    const project = await resolveBotProject({} as D1Database, { ref_code: 'legacy-ref' });
    expect(project).toBe('ai-shain-link');
  });

  it('falls back to defaultProject when project is not registered in bot.config.json', async () => {
    vi.mocked(getEntryRouteByRefCode).mockResolvedValueOnce({ ref_code: 'x', project: 'unknown-product' } as any);
    const project = await resolveBotProject({} as D1Database, { ref_code: 'x' });
    expect(project).toBe('ai-shain-link');
  });

  it('resolves to henshin-hisho when ref_code maps to it', async () => {
    vi.mocked(getEntryRouteByRefCode).mockResolvedValueOnce({ ref_code: 'hh-lp', project: 'henshin-hisho' } as any);
    const project = await resolveBotProject({} as D1Database, { ref_code: 'hh-lp' });
    expect(project).toBe('henshin-hisho');
  });
});
