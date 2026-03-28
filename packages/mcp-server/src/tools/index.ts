import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSendMessage } from "./send-message.js";
import { registerBroadcast } from "./broadcast.js";
import { registerCreateScenario } from "./create-scenario.js";
import { registerEnrollScenario } from "./enroll-scenario.js";
import { registerManageTags } from "./manage-tags.js";
import { registerCreateForm } from "./create-form.js";
import { registerCreateTrackedLink } from "./create-tracked-link.js";
import { registerCreateRichMenu } from "./create-rich-menu.js";
import { registerListFriends } from "./list-friends.js";
import { registerGetFriendDetail } from "./get-friend-detail.js";
import { registerGetFormSubmissions } from "./get-form-submissions.js";
import { registerGetLinkClicks } from "./get-link-clicks.js";
import { registerAccountSummary } from "./account-summary.js";
import { registerListCrmObjects } from "./list-crm-objects.js";
import { registerManageAdPlatforms } from "./manage-ad-platforms.js";
import { registerGetConversionLogs } from "./get-conversion-logs.js";
import { registerManageStaff } from "./manage-staff.js";

export function registerAllTools(server: McpServer): void {
  registerSendMessage(server);
  registerBroadcast(server);
  registerCreateScenario(server);
  registerEnrollScenario(server);
  registerManageTags(server);
  registerCreateForm(server);
  registerCreateTrackedLink(server);
  registerCreateRichMenu(server);
  registerListFriends(server);
  registerGetFriendDetail(server);
  registerGetFormSubmissions(server);
  registerGetLinkClicks(server);
  registerAccountSummary(server);
  registerListCrmObjects(server);
  registerManageAdPlatforms(server);
  registerGetConversionLogs(server);
  registerManageStaff(server);
}
