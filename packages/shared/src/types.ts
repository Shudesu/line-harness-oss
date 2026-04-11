// =============================================================================
// LINE OSS CRM - 共有型定義
// Cloudflare D1 の挙動:
//   - TEXT / BLOB 列 → string
//   - INTEGER / REAL 列 → number
//   - NULL 列 → null
// IDと日付は TEXT で格納するため string 型を使用する
// =============================================================================

// -----------------------------------------------------------------------------
// 友だち (Friend)
// -----------------------------------------------------------------------------
export interface Friend {
  /** 主キー (UUIDv4) */
  id: string;
  /** LINE ユーザーID */
  lineUserId: string;
  /** 表示名 */
  displayName: string;
  /** プロフィール画像URL */
  pictureUrl: string | null;
  /** ステータスメッセージ */
  statusMessage: string | null;
  /**
   * フォロー中かどうか (ブロック・退会で false になる)
   * D1はBOOLEANをINTEGER(0/1)で格納するが、Cloudflare D1クライアントはJavaScript boolean に変換して返す
   */
  isFollowing: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// タグ (Tag)
// -----------------------------------------------------------------------------
export interface Tag {
  /** 主キー (UUIDv4) */
  id: string;
  /** タグ名 */
  name: string;
  /** 表示色 (HEX: #RRGGBB) */
  color: string;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 友だち×タグ 中間テーブル (FriendTag)
// -----------------------------------------------------------------------------
export interface FriendTag {
  /** 友だちID */
  friendId: string;
  /** タグID */
  tagId: string;
  /** 割り当て日時 (ISO 8601) */
  assignedAt: string;
}

// -----------------------------------------------------------------------------
// シナリオ (Scenario)
// -----------------------------------------------------------------------------

/** シナリオのトリガー種別 */
export type ScenarioTriggerType = "friend_add" | "tag_added" | "manual";

export interface Scenario {
  /** 主キー (UUIDv4) */
  id: string;
  /** シナリオ名 */
  name: string;
  /** 説明文 */
  description: string | null;
  /** トリガー種別 */
  triggerType: ScenarioTriggerType;
  /** トリガーとなるタグID (triggerType が 'tag_added' の場合のみ使用) */
  triggerTagId: string | null;
  /** 有効/無効フラグ */
  isActive: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// シナリオステップ (ScenarioStep)
// -----------------------------------------------------------------------------

/** メッセージ種別 */
export type MessageType = "text" | "image" | "flex";

export interface ScenarioStep {
  /** 主キー (UUIDv4) */
  id: string;
  /** 所属するシナリオID */
  scenarioId: string;
  /** ステップ順序 (1始まり) */
  stepOrder: number;
  /** 前のステップからの遅延時間 (分) */
  delayMinutes: number;
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 (テキスト or JSONシリアライズ済みFlexメッセージ等) */
  messageContent: string;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 友だち×シナリオ 進捗テーブル (FriendScenario)
// -----------------------------------------------------------------------------

/** シナリオ配信ステータス */
export type FriendScenarioStatus = "active" | "paused" | "completed";

export interface FriendScenario {
  /** 主キー (UUIDv4) */
  id: string;
  /** 友だちID */
  friendId: string;
  /** シナリオID */
  scenarioId: string;
  /** 現在処理中のステップ順序 */
  currentStepOrder: number;
  /** 配信ステータス */
  status: FriendScenarioStatus;
  /** 開始日時 (ISO 8601) */
  startedAt: string;
  /** 次回配信予定日時 (ISO 8601、null は配信完了) */
  nextDeliveryAt: string | null;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 一斉配信 (Broadcast)
// -----------------------------------------------------------------------------

/** 配信対象種別 */
export type BroadcastTargetType = "all" | "tag";

/** 配信ステータス */
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent";

export interface Broadcast {
  /** 主キー (UUIDv4) */
  id: string;
  /** 配信タイトル (管理用ラベル) */
  title: string;
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 */
  messageContent: string;
  /** 配信対象種別 */
  targetType: BroadcastTargetType;
  /** 対象タグID (targetType が 'tag' の場合のみ使用) */
  targetTagId: string | null;
  /** 配信ステータス */
  status: BroadcastStatus;
  /** 予約配信日時 (ISO 8601、即時配信の場合は null) */
  scheduledAt: string | null;
  /** 配信完了日時 (ISO 8601) */
  sentAt: string | null;
  /** 配信対象人数 */
  totalCount: number;
  /** 配信成功人数 */
  successCount: number;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// メッセージログ (MessageLog)
// -----------------------------------------------------------------------------

/** メッセージの方向 */
export type MessageDirection = "incoming" | "outgoing";

export interface MessageLog {
  /** 主キー (UUIDv4) */
  id: string;
  /** 友だちID */
  friendId: string;
  /** メッセージ方向 (incoming: ユーザー→Bot, outgoing: Bot→ユーザー) */
  direction: MessageDirection;
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 */
  content: string;
  /** 紐付く一斉配信ID (outgoing かつ配信経由の場合) */
  broadcastId: string | null;
  /** 紐付くシナリオステップID (outgoing かつシナリオ経由の場合) */
  scenarioStepId: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 自動返信 (AutoReply)
// -----------------------------------------------------------------------------

/** キーワードマッチ種別 */
export type AutoReplyMatchType = "exact" | "contains";

export interface AutoReply {
  /** 主キー (UUIDv4) */
  id: string;
  /** マッチさせるキーワード */
  keyword: string;
  /** マッチ種別 (exact: 完全一致, contains: 部分一致) */
  matchType: AutoReplyMatchType;
  /** レスポンスメッセージ種別 */
  responseType: MessageType;
  /** レスポンス内容 */
  responseContent: string;
  /** 有効/無効フラグ */
  isActive: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 管理ユーザー (AdminUser)
// -----------------------------------------------------------------------------

/**
 * 管理ユーザー (内部用 — パスワードハッシュを含む)
 * ※ API レスポンスとして直接返してはならない。フロントへは AdminUserPublic を使う。
 */
export interface AdminUser {
  /** 主キー (UUIDv4) */
  id: string;
  /** メールアドレス */
  email: string;
  /** パスワードハッシュ (bcrypt) — フロントエンドに絶対に返さないこと */
  passwordHash: string;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

/**
 * 管理ユーザー (公開用 — パスワードハッシュを除いたもの)
 * API レスポンスやセッション情報にはこちらを使う。
 */
export type AdminUserPublic = Omit<AdminUser, "passwordHash">;

// -----------------------------------------------------------------------------
// 内部ユーザー (User) — UUID Cross-Account System
// -----------------------------------------------------------------------------

export interface User {
  /** 主キー (UUIDv4) — 内部UUID */
  id: string;
  /** メールアドレス (識別子) */
  email: string | null;
  /** 電話番号 (識別子) */
  phone: string | null;
  /** 外部システムID */
  externalId: string | null;
  /** 表示名 */
  displayName: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// LINE アカウント (LineAccount) — マルチアカウント管理
// -----------------------------------------------------------------------------

export interface LineAccount {
  /** 主キー (UUIDv4) */
  id: string;
  /** LINE Channel ID */
  channelId: string;
  /** アカウント名 */
  name: string;
  /** Channel Access Token */
  channelAccessToken: string;
  /** Channel Secret */
  channelSecret: string;
  /** 有効/無効 */
  isActive: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// LINE 友だちリンク (LineFriend) — LINE userId ↔ 内部UUID マッピング
// -----------------------------------------------------------------------------

export interface LineFriend {
  /** 主キー (UUIDv4) */
  id: string;
  /** LINE ユーザーID (アカウントごとに異なる) */
  lineUserId: string;
  /** LINE アカウントID */
  lineAccountId: string;
  /** 内部ユーザーUUID (紐付け済みの場合) */
  userId: string | null;
  /** 表示名 */
  displayName: string | null;
  /** プロフィール画像URL */
  pictureUrl: string | null;
  /** フォロー中かどうか */
  isFollowing: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// コンバージョンポイント (ConversionPoint) — CV計測
// -----------------------------------------------------------------------------

export interface ConversionPoint {
  /** 主キー (UUIDv4) */
  id: string;
  /** CV名 */
  name: string;
  /** CV種別 */
  eventType: string;
  /** 金額 (任意) */
  value: number | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// コンバージョンイベント (ConversionEvent) — CV記録
// -----------------------------------------------------------------------------

export interface ConversionEvent {
  /** 主キー (UUIDv4) */
  id: string;
  /** コンバージョンポイントID */
  conversionPointId: string;
  /** 友だちID */
  friendId: string;
  /** 内部ユーザーUUID */
  userId: string | null;
  /** アフィリエイトコード */
  affiliateCode: string | null;
  /** メタデータ (JSON) */
  metadata: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// アフィリエイト (Affiliate) — アフィリエイト管理
// -----------------------------------------------------------------------------

export interface Affiliate {
  /** 主キー (UUIDv4) */
  id: string;
  /** アフィリエイト名 */
  name: string;
  /** トラッキングコード (ユニーク) */
  code: string;
  /** コミッション率 (0-100) */
  commissionRate: number;
  /** 有効/無効 */
  isActive: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// アフィリエイトクリック (AffiliateClick) — クリック記録
// -----------------------------------------------------------------------------

export interface AffiliateClick {
  /** 主キー (UUIDv4) */
  id: string;
  /** アフィリエイトID */
  affiliateId: string;
  /** リファラURL */
  url: string | null;
  /** IPアドレス */
  ipAddress: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 受信Webhook (IncomingWebhook)
// -----------------------------------------------------------------------------

export interface IncomingWebhook {
  id: string;
  name: string;
  sourceType: string;
  secret: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 送信Webhook (OutgoingWebhook)
// -----------------------------------------------------------------------------

export interface OutgoingWebhook {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  secret: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Google Calendar 連携
// -----------------------------------------------------------------------------

export interface GoogleCalendarConnection {
  id: string;
  calendarId: string;
  authType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarBooking {
  id: string;
  connectionId: string;
  friendId: string | null;
  eventId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  status: "confirmed" | "cancelled" | "completed";
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// リマインダ (Reminder)
// -----------------------------------------------------------------------------

export interface Reminder {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderStep {
  id: string;
  reminderId: string;
  offsetMinutes: number;
  messageType: MessageType;
  messageContent: string;
  createdAt: string;
}

export interface FriendReminder {
  id: string;
  friendId: string;
  reminderId: string;
  targetDate: string;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// スコアリング (Lead Scoring)
// -----------------------------------------------------------------------------

export interface ScoringRule {
  id: string;
  name: string;
  eventType: string;
  scoreValue: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FriendScore {
  id: string;
  friendId: string;
  scoringRuleId: string | null;
  scoreChange: number;
  reason: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// テンプレート (Template)
// -----------------------------------------------------------------------------

export interface Template {
  id: string;
  name: string;
  category: string;
  messageType: string;
  messageContent: string;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// オペレーター (Operator)
// -----------------------------------------------------------------------------

export interface Operator {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// チャット (Chat)
// -----------------------------------------------------------------------------

export interface Chat {
  id: string;
  friendId: string;
  operatorId: string | null;
  status: "unread" | "in_progress" | "resolved";
  notes: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 通知ルール (NotificationRule)
// -----------------------------------------------------------------------------

export interface NotificationRule {
  id: string;
  name: string;
  eventType: string;
  conditions: Record<string, unknown>;
  channels: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  ruleId: string | null;
  eventType: string;
  title: string;
  body: string;
  channel: string;
  status: "pending" | "sent" | "failed";
  metadata: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Stripe イベント (StripeEvent)
// -----------------------------------------------------------------------------

export interface StripeEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  friendId: string | null;
  amount: number | null;
  currency: string | null;
  metadata: string | null;
  processedAt: string;
}

// -----------------------------------------------------------------------------
// アカウントヘルス (AccountHealth)
// -----------------------------------------------------------------------------

export interface AccountHealthLog {
  id: string;
  lineAccountId: string;
  errorCode: number | null;
  errorCount: number;
  checkPeriod: string;
  riskLevel: "normal" | "warning" | "danger";
  createdAt: string;
}

export interface AccountMigration {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  migratedCount: number;
  totalCount: number;
  createdAt: string;
  completedAt: string | null;
}

// -----------------------------------------------------------------------------
// 自動化 (Automation)
// -----------------------------------------------------------------------------

export type AutomationEventType =
  | "friend_add"
  | "tag_change"
  | "score_threshold"
  | "cv_fire"
  | "message_received"
  | "calendar_booked";

export interface AutomationAction {
  type: "add_tag" | "remove_tag" | "start_scenario" | "send_message" | "send_webhook" | "switch_rich_menu";
  params: Record<string, unknown>;
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  eventType: AutomationEventType;
  conditions: Record<string, unknown>;
  actions: AutomationAction[];
  isActive: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationLog {
  id: string;
  automationId: string;
  friendId: string | null;
  eventData: string | null;
  actionsResult: string | null;
  status: "success" | "partial" | "failed";
  createdAt: string;
}

// -----------------------------------------------------------------------------
// スタッフ (StaffMember)
// -----------------------------------------------------------------------------
export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  apiKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffProfile {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  email: string | null;
}

// =============================================================================
// API レスポンスラッパー型
// =============================================================================

/**
 * 汎用 API レスポンス型
 * 成功時は data を持ち、失敗時は error メッセージを持つ
 */
export type ApiResponse<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
      /** バリデーションエラー等の詳細 (任意) */
      details?: Record<string, string[]>;
    };

/**
 * ページネーション付き API レスポンス型
 * エラーハンドリングが必要な場合は ApiResponse<PaginatedResponse<T>> として使う。
 * 例: `ApiResponse<PaginatedResponse<Friend>>`
 */
export interface PaginatedResponse<T> {
  /** データ一覧 */
  items: T[];
  /** 総件数 */
  total: number;
  /** 現在のページ番号 (1始まり) */
  page: number;
  /** 1ページあたりの件数 */
  limit: number;
  /** 次ページが存在するか */
  hasNextPage: boolean;
}
