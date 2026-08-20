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

export interface TextEventMessage {
  type: 'text';
  id: string;
  text: string;
}

export interface ImageEventMessage {
  type: 'image';
  id: string;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
}

export interface VideoEventMessage {
  type: 'video';
  id: string;
  duration: number;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
}

export interface AudioEventMessage {
  type: 'audio';
  id: string;
  duration: number;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
  };
}

export interface FileEventMessage {
  type: 'file';
  id: string;
  fileName: string;
  fileSize: number;
}

export interface LocationEventMessage {
  type: 'location';
  id: string;
  title?: string;
  address?: string;
  latitude: number;
  longitude: number;
}

export interface StickerEventMessage {
  type: 'sticker';
  id: string;
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

/**
 * Per-message sender override — changes the icon and display name shown on the
 * bubble. LINE appends `from '<account name>'` to the display name and the name
 * at the top of the talk room is unchanged.
 *
 * https://developers.line.biz/en/docs/messaging-api/icon-nickname-switch/
 * Constraints (Messaging API reference, `Sender` schema):
 *   name    — max 20 characters. Certain words such as `LINE` may not be used.
 *   iconUrl — max 2000 characters, HTTPS URL of a JPEG/PNG image.
 */
export interface Sender {
  name?: string;
  iconUrl?: string;
}

/** Properties every send-message object accepts. */
export interface MessageCommonProperties {
  sender?: Sender;
}

export interface TextMessage extends MessageCommonProperties {
  type: 'text';
  text: string;
}

export interface ImageMessage extends MessageCommonProperties {
  type: 'image';
  originalContentUrl: string;
  previewImageUrl: string;
}

export interface FlexMessage extends MessageCommonProperties {
  type: 'flex';
  altText: string;
  contents: FlexContainer;
}

export interface VideoMessage extends MessageCommonProperties {
  type: 'video';
  originalContentUrl: string;
  previewImageUrl: string;
}

export interface TemplateMessage extends MessageCommonProperties {
  type: 'template';
  altText: string;
  template: Record<string, unknown>;
}

export interface ImageMapMessageType extends MessageCommonProperties {
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
  customAggregationUnits?: string[];
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
