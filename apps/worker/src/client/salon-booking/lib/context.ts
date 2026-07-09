// Salon booking client gets its caller-context from main.ts (existing LIFF
// orchestrator). main.ts has already called liff.init() and resolved the
// LINE userId / id_token before mounting React; we just consume.
//
// friend UUID は intentionally 持たない: booking エンドポイントは id_token で
// caller を verify し、friends.line_user_id から UUID を引くため React 側では不要。

import { createContext, useContext } from 'react';
import type { SalonBookingLabels } from './labels.js';

export interface SalonBookingContext {
  liffId: string;
  lineUserId: string;
  idToken: string;
  labels: SalonBookingLabels;
}

export type SalonBookingMountContext = Omit<SalonBookingContext, 'labels'>;

const Ctx = createContext<SalonBookingContext | null>(null);

export const SalonBookingProvider = Ctx.Provider;

export function useSalonContext(): SalonBookingContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('SalonBookingContext not provided');
  return v;
}
