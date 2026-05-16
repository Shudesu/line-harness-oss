export { LineHarness } from './client.js'
export { LineHarnessError } from './errors.js'
export { parseDelay } from './delay.js'

// Resource classes (for advanced usage / type narrowing)
export { FriendsResource } from './resources/friends.js'
export { TagsResource } from './resources/tags.js'
export { ScenariosResource } from './resources/scenarios.js'
export { BroadcastsResource } from './resources/broadcasts.js'
export { RichMenusResource } from './resources/rich-menus.js'
export { TemplatesResource } from './resources/templates.js'
export { TrackedLinksResource } from './resources/tracked-links.js'
export { FormsResource } from './resources/forms.js'
export { AdPlatformsResource } from './resources/ad-platforms.js'
export { StaffResource } from './resources/staff.js'
export { ImagesResource } from './resources/images.js'
export { AutoRepliesResource } from './resources/auto-replies.js'
export { ConversationsResource } from './resources/conversations.js'
export { ReservationsResource } from './resources/reservations.js'

// All types
export type {
  LineHarnessConfig,
  ApiResponse,
  PaginatedData,
  ScenarioTriggerType,
  MessageType,
  BroadcastStatus,
  Friend,
  FriendListParams,
  Tag,
  CreateTagInput,
  Scenario,
  ScenarioListItem,
  ScenarioWithSteps,
  ScenarioStep,
  CreateScenarioInput,
  CreateStepInput,
  UpdateScenarioInput,
  UpdateStepInput,
  FriendScenarioEnrollment,
  Broadcast,
  CreateBroadcastInput,
  UpdateBroadcastInput,
  SegmentRule,
  SegmentCondition,
  StepDefinition,
  RichMenu,
  RichMenuBounds,
  RichMenuAction,
  RichMenuArea,
  CreateRichMenuInput,
  Template,
  CreateTemplateInput,
  UpdateTemplateInput,
  TrackedLink,
  LinkClick,
  TrackedLinkWithClicks,
  CreateTrackedLinkInput,
  FormField,
  Form,
  CreateFormInput,
  UpdateFormInput,
  FormSubmission,
  StaffRole,
  StaffMember,
  StaffProfile,
  CreateStaffInput,
  UpdateStaffInput,
  UploadedImage,
  UploadImageInput,
  AutoReply,
  CreateAutoReplyInput,
  UpdateAutoReplyInput,
  MessageSource,
  ConversationSummary,
  ConversationListParams,
  ConversationListResponse,
  ConversationMessage,
  ConversationDetail,
  GetConversationParams,
} from './types.js'

export type {
  CreateReservationResourceInput,
  CreateReservationMenuInput,
  CreateReservationScheduleInput,
  GenerateReservationSlotsInput,
  ListReservationSlotsParams,
  ListReservationsParams,
  CreateReservationInput,
  UpdateReservationStatusInput,
  CreateReservationSessionInput,
  ListPublicReservationSlotsParams,
  CreatePublicReservationInput,
  ListMyReservationsParams,
  GetPublicReservationDetailInput,
  CancelPublicReservationInput,
  ImportJalanReservationInput,
  StartGoogleCalendarOAuthInput,
} from './resources/reservations.js'

export type {
  CapacityChannel,
  ExternalReservationEventType,
  ExternalReservationParseStatus,
  ExternalReservationSourceResponse,
  PublicReservationSlot,
  Reservation,
  ReservationApiErrorCode,
  ReservationApiResponse,
  ReservationCancelResponse,
  ReservationCreateResponse,
  ReservationImportResponse,
  ReservationMenu,
  ReservationResource,
  ReservationSchedule,
  ReservationSessionResponse,
  ReservationSlot,
  ReservationSlotAvailability,
  ReservationSlotStatus,
  ReservationSlotWithAvailability,
  ReservationSource,
  ReservationStatus,
} from '@line-crm/shared'

export type {
  AdPlatform,
  AdConversionLog,
  CreateAdPlatformInput,
  UpdateAdPlatformInput,
} from './resources/ad-platforms.js'
