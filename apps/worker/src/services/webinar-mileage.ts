import { awardActivityMileage } from './activity-mileage.js';

export type WebinarMileageMilestone = {
  eventType: 'webinar_watch_5m' | 'webinar_watch_15m' | 'webinar_completed';
  key: '5m' | '15m' | 'complete';
};

export function webinarMileageMilestones(
  positionSeconds: number,
  durationSeconds: number,
): WebinarMileageMilestone[] {
  const milestones: WebinarMileageMilestone[] = [];
  if (positionSeconds >= 300) milestones.push({ eventType: 'webinar_watch_5m', key: '5m' });
  if (positionSeconds >= 900) milestones.push({ eventType: 'webinar_watch_15m', key: '15m' });
  if (durationSeconds > 0 && positionSeconds >= Math.floor(durationSeconds * 0.9)) {
    milestones.push({ eventType: 'webinar_completed', key: 'complete' });
  }
  return milestones;
}

export async function awardWebinarPositionMileage(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    positionSeconds: number;
    durationSeconds: number;
  },
): Promise<void> {
  await Promise.all(
    webinarMileageMilestones(input.positionSeconds, input.durationSeconds).map((milestone) =>
      awardActivityMileage(db, {
        eventType: milestone.eventType,
        source: 'webinar',
        sourceEventId: `${input.webinarId}:${input.friendId}:${milestone.key}`,
        friendId: input.friendId,
        subjectKey: input.webinarId,
        metadata: {
          webinarId: input.webinarId,
          sessionStartAt: input.sessionStartAt,
          positionSeconds: input.positionSeconds,
          durationSeconds: input.durationSeconds,
          milestone: milestone.key,
        },
      }),
    ),
  );
}

export async function awardWebinarCtaMileage(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    ctaId?: string | null;
  },
): Promise<void> {
  const ctaId = input.ctaId || 'primary';
  await awardActivityMileage(db, {
    eventType: 'webinar_cta_clicked',
    source: 'webinar',
    sourceEventId: `${input.webinarId}:${input.friendId}:${input.sessionStartAt}:${ctaId}`,
    friendId: input.friendId,
    subjectKey: `${input.webinarId}:${ctaId}`,
    metadata: { webinarId: input.webinarId, sessionStartAt: input.sessionStartAt, ctaId },
  });
}
