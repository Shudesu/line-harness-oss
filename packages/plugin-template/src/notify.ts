/**
 * Notify: check external conditions and send LINE messages via LINE Harness SDK.
 *
 * Common patterns:
 * - Appointment reminder (24h before)
 * - Payment overdue alert
 * - New content/offer notification
 * - Membership expiry warning
 */

import { LineHarness } from '@line-harness/sdk'
import { MyServiceClient } from './external-api.js'
import type { Env } from './index.js'

/**
 * Check conditions in MyService and send relevant notifications.
 */
export async function checkAndNotify(env: Env): Promise<void> {
  const harness = new LineHarness({
    apiUrl: env.LINE_HARNESS_API_URL,
    apiKey: env.LINE_HARNESS_API_KEY,
    lineAccountId: env.LINE_ACCOUNT_ID,
  })
  const myService = new MyServiceClient(env.EXTERNAL_API_KEY)

  // Example 1: Send appointment reminders
  await sendAppointmentReminders(harness, myService)

  // Example 2: Notify about expiring memberships
  await notifyExpiringMemberships(harness, myService)
}

/**
 * Example: send a reminder to friends with upcoming appointments.
 */
async function sendAppointmentReminders(
  harness: LineHarness,
  myService: MyServiceClient,
): Promise<void> {
  const upcoming = await myService.getUpcomingAppointments(24) // next 24 hours

  // Ensure a dedup tag exists for appointment reminders
  const allTags = await harness.tags.list()
  let reminderTag = allTags.find((t) => t.name === 'myservice:appt-reminded')
  if (!reminderTag) {
    reminderTag = await harness.tags.create({ name: 'myservice:appt-reminded', color: '#6B7280' })
  }

  for (const appointment of upcoming) {
    if (!appointment.lineHarnessFriendId) continue

    try {
      // Check if we already sent a reminder (dedup via tag)
      const friend = await harness.friends.get(appointment.lineHarnessFriendId)
      if (friend.tags.some((t) => t.name === 'myservice:appt-reminded')) {
        console.log(`[Notify] Skipping (already reminded): ${appointment.lineHarnessFriendId}`)
        continue
      }

      // Tag FIRST to prevent duplicates if the message send succeeds but
      // a subsequent cron run happens before the tag would have been written
      await harness.friends.addTag(appointment.lineHarnessFriendId, reminderTag.id)

      await harness.sendTextToFriend(
        appointment.lineHarnessFriendId,
        `Reminder: you have an appointment tomorrow at ${appointment.time}.\n\n` +
          `Location: ${appointment.location}\n` +
          `If you need to reschedule, please contact us.`,
      )

      console.log(`[Notify] Sent reminder to ${appointment.lineHarnessFriendId}`)
    } catch (error) {
      console.error(`[Notify] Failed to send reminder:`, error)
    }
  }
}

/**
 * Example: notify friends whose memberships expire within 7 days.
 * Uses Flex Message for a richer layout.
 */
async function notifyExpiringMemberships(
  harness: LineHarness,
  myService: MyServiceClient,
): Promise<void> {
  const expiring = await myService.getExpiringMemberships(7) // next 7 days

  // Ensure a dedup tag exists for renewal reminders
  const allTags = await harness.tags.list()
  let renewalTag = allTags.find((t) => t.name === 'myservice:renewal-reminder')
  if (!renewalTag) {
    renewalTag = await harness.tags.create({ name: 'myservice:renewal-reminder', color: '#F59E0B' })
  }

  for (const membership of expiring) {
    if (!membership.lineHarnessFriendId) continue

    try {
      // Check if we already sent a renewal reminder (dedup via tag)
      const friend = await harness.friends.get(membership.lineHarnessFriendId)
      if (friend.tags.some((t) => t.name === 'myservice:renewal-reminder')) {
        console.log(`[Notify] Skipping (already notified): ${membership.lineHarnessFriendId}`)
        continue
      }

      // Tag FIRST to prevent duplicate sends on subsequent cron runs
      await harness.friends.addTag(membership.lineHarnessFriendId, renewalTag.id)

      // Build a Flex Message for a richer notification
      const flexMessage = JSON.stringify({
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'Membership Expiring Soon',
              weight: 'bold',
              size: 'lg',
            },
            {
              type: 'text',
              text: `Your ${membership.planName} membership expires on ${membership.expiresAt}.`,
              wrap: true,
              margin: 'md',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: {
                type: 'uri',
                label: 'Renew Now',
                uri: membership.renewUrl,
              },
              style: 'primary',
            },
          ],
        },
      })

      await harness.sendFlexToFriend(
        membership.lineHarnessFriendId,
        flexMessage,
      )

      console.log(`[Notify] Sent renewal reminder to ${membership.lineHarnessFriendId}`)
    } catch (error) {
      console.error(`[Notify] Failed to send renewal reminder:`, error)
    }
  }
}
