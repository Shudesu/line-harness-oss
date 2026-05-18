// ─── Source types ────────────────────────────────────────────────────────────

export interface UserSource {
  type: 'user';
  userId: string;
}

export interface GroupSource {
  type: 'group';
  groupId: string;
  userId?: string;
}

export interface RoomSource {
  type: 'room';
  roomId: string;
  userId?: string;
}

export type Source = UserSource | GroupSource | RoomSource;

// ─── Message subtypes ────────────────────────────────────────────────────────

export interface BaseEventMessage {
  id: string;
  markAsReadToken?: string;
}

export interface TextEventMessage extends BaseEventMessage {
  type: 'text';
  text: string;
}

export interface ImageEventMessage extends BaseEventMessage {
  type: 'image';
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
}

export interface VideoEventMessage extends BaseEventMessage {
  type: 'video';
  duration: number;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
}

export interface AudioEventMessage extends BaseEventMessage {
  type: 'audio';
  duration: number;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
  };
}

export interface FileEventMessage extends BaseEventMessage {
  type: 'file';
  fileName: string;
  fileSize: number;
}

export interface LocationEventMessage extends BaseEventMessage {
  type: 'location';
  title?: string;
  address?: string;
  latitude: number;
  longitude: number;
}

export interface StickerEventMessage extends BaseEventMessage {
  type: 'sticker';
  packageId: string;
  stickerId: string;
  stickerResourceType: string;
}

export type EventMessage =
  | TextEventMessage
  | ImageEventMessage
  | VideoEventMessage
  | AudioEventMessage
  | FileEventMessage
  | LocationEventMessage
  | StickerEventMessage;

// ─── Webhook events ───────────────────────────────────────────────────────────

interface BaseEvent {
  timestamp: number;
  source: Source;
  webhookEventId: string;
  deliveryContext: {
    isRedelivery: boolean;
  };
  mode: 'active' | 'standby' | 'channel';
}

export interface MessageEvent extends BaseEvent {
  type: 'message';
  replyToken: string;
  message: EventMessage;
}

export interface FollowEvent extends BaseEvent {
  type: 'follow';
  replyToken: string;
  source: UserSource | GroupSource | RoomSource;
}

export interface UnfollowEvent extends BaseEvent {
  type: 'unfollow';
  source: UserSource | GroupSource | RoomSource;
}

export interface PostbackEvent extends BaseEvent {
  type: 'postback';
  replyToken: string;
  postback: {
    data: string;
    params?: Record<string, string>;
  };
}

export type WebhookEvent =
  | MessageEvent
  | FollowEvent
  | UnfollowEvent
  | PostbackEvent;

export interface WebhookRequestBody {
  destination: string;
  events: WebhookEvent[];
}

// ─── User profile ─────────────────────────────────────────────────────────────

export interface UserProfile {
  displayName: string;
  userId: string;
  pictureUrl?: string;
  statusMessage?: string;
}

// ─── Send message types ───────────────────────────────────────────────────────

export type FlexContainer = object;

export interface TextMessage {
  type: 'text';
  text: string;
}

export interface ImageMessage {
  type: 'image';
  originalContentUrl: string;
  previewImageUrl: string;
}

export interface FlexMessage {
  type: 'flex';
  altText: string;
  contents: FlexContainer;
}

export interface VideoMessage {
  type: 'video';
  originalContentUrl: string;
  previewImageUrl: string;
}

export interface TemplateMessage {
  type: 'template';
  altText: string;
  template: Record<string, unknown>;
}

export interface ImageMapMessageType {
  type: 'imagemap';
  baseUrl: string;
  altText: string;
  baseSize: { width: number; height: number };
  actions: Record<string, unknown>[];
}

export type Message =
  | TextMessage
  | ImageMessage
  | FlexMessage
  | VideoMessage
  | TemplateMessage
  | ImageMapMessageType;

// ─── Rich Menu types ──────────────────────────────────────────────────────────

export interface RichMenuSize {
  width: number;
  height: number;
}

export interface RichMenuBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RichMenuActionPostback {
  type: 'postback';
  data: string;
  displayText?: string;
  label?: string;
}

export interface RichMenuActionMessage {
  type: 'message';
  text: string;
  label?: string;
}

export interface RichMenuActionUri {
  type: 'uri';
  uri: string;
  label?: string;
}

export interface RichMenuActionDatetimePicker {
  type: 'datetimepicker';
  data: string;
  mode: 'date' | 'time' | 'datetime';
  label?: string;
}

export interface RichMenuActionRichMenuSwitch {
  type: 'richmenuswitch';
  richMenuAliasId: string;
  data: string;
  label?: string;
}

export type RichMenuAction =
  | RichMenuActionPostback
  | RichMenuActionMessage
  | RichMenuActionUri
  | RichMenuActionDatetimePicker
  | RichMenuActionRichMenuSwitch;

export interface RichMenuArea {
  bounds: RichMenuBounds;
  action: RichMenuAction;
}

export interface RichMenuObject {
  richMenuId?: string;
  size: RichMenuSize;
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: RichMenuArea[];
}

// ─── Request types ────────────────────────────────────────────────────────────

export interface PushMessageRequest {
  to: string;
  messages: Message[];
}

export interface MulticastRequest {
  to: string[];
  messages: Message[];
}

export interface BroadcastRequest {
  messages: Message[];
}

export interface ReplyMessageRequest {
  replyToken: string;
  messages: Message[];
}
