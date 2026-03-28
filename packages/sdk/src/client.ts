import { HttpClient } from './http.js'
import { FriendsResource } from './resources/friends.js'
import { TagsResource } from './resources/tags.js'
import { ScenariosResource } from './resources/scenarios.js'
import { BroadcastsResource } from './resources/broadcasts.js'
import { RichMenusResource } from './resources/rich-menus.js'
import { TrackedLinksResource } from './resources/tracked-links.js'
import { FormsResource } from './resources/forms.js'
import { AdPlatformsResource } from './resources/ad-platforms.js'
import { StaffResource } from './resources/staff.js'
import { Workflows } from './workflows.js'
import type { LineHarnessConfig, StepDefinition, ScenarioTriggerType, ScenarioWithSteps, Broadcast, MessageType, SegmentCondition } from './types.js'

export class LineHarness {
  readonly friends: FriendsResource
  readonly tags: TagsResource
  readonly scenarios: ScenariosResource
  readonly broadcasts: BroadcastsResource
  readonly richMenus: RichMenusResource
  readonly trackedLinks: TrackedLinksResource
  readonly forms: FormsResource
  readonly adPlatforms: AdPlatformsResource
  readonly staff: StaffResource

  private readonly apiUrl: string
  private readonly defaultAccountId: string | undefined
  private readonly workflows: Workflows

  readonly createStepScenario: (name: string, triggerType: ScenarioTriggerType, steps: StepDefinition[]) => Promise<ScenarioWithSteps>
  readonly broadcastText: (text: string) => Promise<Broadcast>
  readonly broadcastToTag: (tagId: string, messageType: MessageType, content: string) => Promise<Broadcast>
  readonly broadcastToSegment: (messageType: MessageType, content: string, conditions: SegmentCondition) => Promise<Broadcast>
  readonly sendTextToFriend: (friendId: string, text: string) => Promise<{ messageId: string }>
  readonly sendFlexToFriend: (friendId: string, flexJson: string) => Promise<{ messageId: string }>

  constructor(config: LineHarnessConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '')
    this.defaultAccountId = config.lineAccountId

    const http = new HttpClient({
      baseUrl: this.apiUrl,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30_000,
    })

    this.friends = new FriendsResource(http, this.defaultAccountId)
    this.tags = new TagsResource(http)
    this.scenarios = new ScenariosResource(http, this.defaultAccountId)
    this.broadcasts = new BroadcastsResource(http, this.defaultAccountId)
    this.richMenus = new RichMenusResource(http)
    this.trackedLinks = new TrackedLinksResource(http)
    this.forms = new FormsResource(http)
    this.adPlatforms = new AdPlatformsResource(http)
    this.staff = new StaffResource(http)
    this.workflows = new Workflows(this.friends, this.scenarios, this.broadcasts)

    this.createStepScenario = this.workflows.createStepScenario.bind(this.workflows)
    this.broadcastText = this.workflows.broadcastText.bind(this.workflows)
    this.broadcastToTag = this.workflows.broadcastToTag.bind(this.workflows)
    this.broadcastToSegment = this.workflows.broadcastToSegment.bind(this.workflows)
    this.sendTextToFriend = this.workflows.sendTextToFriend.bind(this.workflows)
    this.sendFlexToFriend = this.workflows.sendFlexToFriend.bind(this.workflows)
  }

  /**
   * Generate friend-add URL with OAuth (bot_prompt=aggressive)
   * This URL does friend-add + UUID in one step.
   *
   * @param ref - Attribution code (e.g., 'lp-a', 'instagram', 'seminar-0322')
   * @param redirect - URL to redirect after completion
   */
  getAuthUrl(options?: { ref?: string; redirect?: string }): string {
    const url = new URL(`${this.apiUrl}/auth/line`)
    if (options?.ref) url.searchParams.set('ref', options.ref)
    if (options?.redirect) url.searchParams.set('redirect', options.redirect)
    return url.toString()
  }
}
