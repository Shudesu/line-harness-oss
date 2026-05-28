import { aonisaiReservationEmailTemplate } from './aonisai/email-template.js';
import { genericReservationEmailTemplate } from './generic/email-template.js';
import type { ReservationEmailTemplate } from './email-types.js';

const templates: Record<string, ReservationEmailTemplate> = {
  generic: genericReservationEmailTemplate,
  aonisai: aonisaiReservationEmailTemplate,
};

export function getReservationEmailTemplate(providerId: string): ReservationEmailTemplate {
  return templates[providerId] ?? genericReservationEmailTemplate;
}
