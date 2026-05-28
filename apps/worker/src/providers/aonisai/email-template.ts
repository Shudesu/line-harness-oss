import type { ReservationEmailTemplate } from '../email-types.js';
import { genericReservationEmailTemplate } from '../generic/email-template.js';

export const aonisaiReservationEmailTemplate: ReservationEmailTemplate = {
  confirmation(input) {
    return genericReservationEmailTemplate.confirmation({
      ...input,
      provider: {
        ...input.provider,
        name: input.provider.name || 'AONISAI FARM BLUEBERRY',
        email: {
          ...input.provider.email,
          footerText: input.provider.email.footerText || 'アオニサイファーム ブルーベリー観光農園',
        },
      },
    });
  },
};
