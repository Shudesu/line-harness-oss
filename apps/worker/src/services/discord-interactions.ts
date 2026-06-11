import type { Reservation } from '@line-crm/db';
import { listReservations, updateReservationStatus } from '@line-crm/db';
import { resolveBindingValue, type SecretLike } from './bindings.js';

type DiscordButton = {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
};

type DiscordActionRow = {
  type: 1;
  components: DiscordButton[];
};

type DiscordEmbed = {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

type DiscordMessage = {
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
  flags?: number;
};

type DiscordInteractionResponse = {
  type: 1 | 4;
  data?: DiscordMessage;
};

type DiscordCommandOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
};

type DiscordInteraction = {
  type: number;
  data?: {
    name?: string;
    custom_id?: string;
    options?: DiscordCommandOption[];
  };
};

export interface DiscordInteractionEnv {
  DISCORD_PUBLIC_KEY?: SecretLike;
}

const DISCORD_PING = 1;
const DISCORD_APPLICATION_COMMAND = 2;
const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_RESPONSE_PONG = 1;
const DISCORD_RESPONSE_CHANNEL_MESSAGE = 4;
const EPHEMERAL = 1 << 6;
const COMPLETE_REQUEST_PREFIX = 'reservation:complete-request:';
const COMPLETE_CONFIRM_PREFIX = 'reservation:complete-confirm:';
const LEGACY_COMPLETE_PREFIX = 'reservation:complete:';
const MAX_VISIBLE_RESERVATIONS = 20;

export async function verifyDiscordInteractionRequest(
  request: Request,
  env: DiscordInteractionEnv,
  body: string,
): Promise<boolean> {
  const publicKey = await resolveBindingValue(env.DISCORD_PUBLIC_KEY);
  if (!publicKey) return false;

  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToArrayBuffer(publicKey),
      { name: 'Ed25519' } as AlgorithmIdentifier,
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'Ed25519' } as AlgorithmIdentifier,
      key,
      hexToArrayBuffer(signature),
      new TextEncoder().encode(`${timestamp}${body}`),
    );
  } catch {
    return false;
  }
}

export async function handleDiscordReservationInteraction(
  db: D1Database,
  interaction: DiscordInteraction,
): Promise<DiscordInteractionResponse> {
  if (interaction.type === DISCORD_PING) {
    return { type: DISCORD_RESPONSE_PONG };
  }

  if (interaction.type === DISCORD_APPLICATION_COMMAND) {
    const date = normalizeDiscordReservationDate(extractDateOption(interaction.data?.options ?? []));
    if (!date) {
      return channelMessage('日付は `YYYYMMDD` または `YYYY-MM-DD` で指定してください。例: `/reservations date:20260612`', true);
    }

    const reservations = await listReservations(db, { date, limit: 500 });
    return {
      type: DISCORD_RESPONSE_CHANNEL_MESSAGE,
      data: buildReservationListMessage(date, reservations),
    };
  }

  if (interaction.type === DISCORD_MESSAGE_COMPONENT) {
    const requestId = parseDiscordReservationCompleteRequestId(interaction.data?.custom_id)
      ?? parseLegacyDiscordReservationCompleteId(interaction.data?.custom_id);
    if (requestId) {
      return {
        type: DISCORD_RESPONSE_CHANNEL_MESSAGE,
        data: buildCompleteConfirmationMessage(requestId),
      };
    }

    const confirmId = parseDiscordReservationCompleteConfirmId(interaction.data?.custom_id);
    if (!confirmId) return channelMessage('未対応のボタンです。', true);

    const result = await updateReservationStatus(db, confirmId, {
      status: 'completed',
      actorType: 'admin',
      actorId: 'discord',
    });

    if (!result.ok) {
      return channelMessage(`来園済みにできませんでした: ${result.reason}`, true);
    }

    const reservation = result.reservation;
    const changedText = result.changed ? '来園済みに変更しました。' : 'すでに来園済みです。';
    return channelMessage(
      `${changedText}\n${reservation.reservation_date} ${timeRange(reservation)} ${safe(reservation.customer_name_snapshot)}`,
      true,
    );
  }

  return channelMessage('未対応のDiscord Interactionです。', true);
}

export function normalizeDiscordReservationDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return validDate(`${compact[1]}-${compact[2]}-${compact[3]}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return validDate(normalized);
  return null;
}

export function buildReservationListMessage(date: string, reservations: Reservation[]): DiscordMessage {
  const active = reservations.filter((item) => item.status === 'pending' || item.status === 'confirmed');
  if (active.length === 0) {
    return {
      content: `📅 ${date} の有効予約はありません。`,
    };
  }

  const visible = active.slice(0, MAX_VISIBLE_RESERVATIONS);
  const fields = visible.map((reservation, index) => ({
    name: `${index + 1}. ${timeRange(reservation)} ${safe(reservation.customer_name_snapshot)}`,
    value: [
      `状態: ${reservation.status}`,
      `人数: ${peopleText(reservation)}`,
      `経路: ${reservation.source}`,
    ].join(' / '),
    inline: false,
  }));

  const rows: DiscordActionRow[] = [];
  for (let i = 0; i < visible.length; i += 5) {
    rows.push({
      type: 1,
      components: visible.slice(i, i + 5).map((reservation) => ({
        type: 2,
        style: 2,
        label: completeRequestButtonLabel(reservation),
        custom_id: buildDiscordReservationCompleteRequestId(reservation.id),
        disabled: reservation.status !== 'confirmed',
      })),
    });
  }

  const more = active.length > visible.length ? `\n表示上限のため、残り${active.length - visible.length}件はWeb管理画面で確認してください。` : '';
  return {
    content: `📅 ${date} の予約 ${active.length}件${more}`,
    embeds: [{
      title: '予約確認',
      color: 0x69a3d0,
      fields,
    }],
    components: rows,
  };
}

export function buildDiscordReservationCompleteId(reservationId: string): string {
  return buildDiscordReservationCompleteConfirmId(reservationId);
}

export function parseDiscordReservationCompleteId(customId: unknown): string | null {
  return parseDiscordReservationCompleteConfirmId(customId);
}

export function buildDiscordReservationCompleteRequestId(reservationId: string): string {
  return `${COMPLETE_REQUEST_PREFIX}${reservationId}`.slice(0, 100);
}

export function parseDiscordReservationCompleteRequestId(customId: unknown): string | null {
  return parseCustomId(customId, COMPLETE_REQUEST_PREFIX);
}

export function buildDiscordReservationCompleteConfirmId(reservationId: string): string {
  return `${COMPLETE_CONFIRM_PREFIX}${reservationId}`.slice(0, 100);
}

export function parseDiscordReservationCompleteConfirmId(customId: unknown): string | null {
  return parseCustomId(customId, COMPLETE_CONFIRM_PREFIX);
}

export function parseLegacyDiscordReservationCompleteId(customId: unknown): string | null {
  return parseCustomId(customId, LEGACY_COMPLETE_PREFIX);
}

export function discordReservationVisibleLimit(): number {
  return MAX_VISIBLE_RESERVATIONS;
}

function extractDateOption(options: DiscordCommandOption[]): string | null {
  const explicit = options.find((option) => option.name === 'date' || option.name === '日付');
  const fallback = explicit ?? options[0];
  return typeof fallback?.value === 'string' ? fallback.value : null;
}

function channelMessage(content: string, ephemeral: boolean): DiscordInteractionResponse {
  return {
    type: DISCORD_RESPONSE_CHANNEL_MESSAGE,
    data: {
      content,
      flags: ephemeral ? EPHEMERAL : undefined,
    },
  };
}

function validDate(value: string): string | null {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

function buildCompleteConfirmationMessage(reservationId: string): DiscordMessage {
  return {
    content: 'この予約を「来園済み」に変更します。間違いなければ下のボタンを押してください。',
    flags: EPHEMERAL,
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 3,
        label: '来園済みにする',
        custom_id: buildDiscordReservationCompleteConfirmId(reservationId),
      }],
    }],
  };
}

function completeRequestButtonLabel(reservation: Reservation): string {
  const name = safe(reservation.customer_name_snapshot);
  return `来園確認 ${timeRange(reservation)} ${truncate(name, 18)}`.slice(0, 80);
}

function peopleText(reservation: Reservation): string {
  return [
    `大人${reservation.adult_count}`,
    `小学生${reservation.child_count}`,
    `幼児${reservation.infant_count}`,
    `3歳以下${reservation.under_three_count}`,
  ].join(' / ');
}

function timeRange(reservation: Pick<Reservation, 'start_at' | 'end_at'>): string {
  return `${reservation.start_at.slice(11, 16)}-${reservation.end_at.slice(11, 16)}`;
}

function safe(value: string | null | undefined): string {
  return value?.trim() || '名前未設定';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function parseCustomId(customId: unknown, prefix: string): string | null {
  if (typeof customId !== 'string' || !customId.startsWith(prefix)) return null;
  const id = customId.slice(prefix.length).trim();
  return id || null;
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const normalized = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}
