import { Hono } from 'hono';
import type { Env } from '../../index.js';
import { adminReservations } from './admin.js';
import { publicReservations } from './public.js';
import { reservationIntegrations } from './integrations.js';

const reservations = new Hono<Env>();

reservations.route('/', publicReservations);
reservations.route('/', adminReservations);
reservations.route('/', reservationIntegrations);

export { reservations };
