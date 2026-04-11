/**
 * Example MCP tool: lookup a customer in MyService and show their LINE Harness profile.
 *
 * This demonstrates how to combine data from the external API and LINE Harness SDK
 * into a single tool that AI agents can call.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { LineHarness } from '@line-harness/sdk'
import { MyServiceClient } from '../external-api-mcp.js'

function getEnvOrThrow(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var: ${key}`)
  return value
}

function getClients() {
  const harness = new LineHarness({
    apiUrl: getEnvOrThrow('LINE_HARNESS_API_URL'),
    apiKey: getEnvOrThrow('LINE_HARNESS_API_KEY'),
  })
  const myService = new MyServiceClient(getEnvOrThrow('EXTERNAL_API_KEY'))
  return { harness, myService }
}

export function registerExampleTool(server: McpServer): void {
  /**
   * Tool: lookup_customer
   * Looks up a customer in MyService and enriches with LINE Harness data.
   */
  server.tool(
    'lookup_customer',
    'Look up a customer in MyService and show their LINE profile, tags, and membership status.',
    {
      customerId: z.string().describe('The customer ID in MyService'),
    },
    async ({ customerId }) => {
      try {
        const { harness, myService } = getClients()

        // Fetch customer from MyService
        const customer = await myService.getCustomer(customerId)

        // Try to find the corresponding LINE friend (paginate through all)
        let lineFriend = null
        if (customer.lineUserId) {
          let offset = 0
          const pageSize = 100
          while (!lineFriend) {
            const page = await harness.friends.list({ limit: pageSize, offset })
            lineFriend = page.items.find(
              (f) => f.lineUserId === customer.lineUserId,
            ) ?? null
            if (!page.hasNextPage) break
            offset += pageSize
          }
        }

        const result = {
          customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            tier: customer.tier,
            visitCount: customer.visitCount,
            lastVisit: customer.lastVisitDate,
          },
          lineHarness: lineFriend
            ? {
                friendId: lineFriend.id,
                displayName: lineFriend.displayName,
                isFollowing: lineFriend.isFollowing,
                tags: lineFriend.tags.map((t) => t.name),
                metadata: lineFriend.metadata,
              }
            : null,
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: String(error) }, null, 2),
            },
          ],
          isError: true,
        }
      }
    },
  )

  /**
   * Tool: send_myservice_notification
   * Send a notification about a MyService event to a LINE friend.
   */
  server.tool(
    'send_myservice_notification',
    'Send a MyService-related notification (appointment reminder, etc.) to a LINE friend.',
    {
      friendId: z.string().describe('LINE Harness friend ID'),
      notificationType: z
        .enum(['appointment_reminder', 'membership_expiry', 'custom'])
        .describe('Type of notification to send'),
      message: z
        .string()
        .optional()
        .describe('Custom message text (required for "custom" type)'),
      customerId: z
        .string()
        .optional()
        .describe('MyService customer ID (for auto-generating message content)'),
    },
    async ({ friendId, notificationType, message, customerId }) => {
      try {
        const { harness, myService } = getClients()

        let messageText: string

        if (notificationType === 'custom') {
          if (!message) {
            throw new Error('message is required for custom notification type')
          }
          messageText = message
        } else if (notificationType === 'appointment_reminder' && customerId) {
          const appointments = await myService.getUpcomingAppointments(48)
          const next = appointments.find((a) => a.customerId === customerId)
          if (!next) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    success: false,
                    reason: 'No upcoming appointments found',
                  }),
                },
              ],
            }
          }
          messageText =
            `Reminder: your appointment is on ${next.date} at ${next.time}.\n` +
            `Location: ${next.location}`
        } else {
          messageText = message ?? 'You have a notification from MyService.'
        }

        const result = await harness.sendTextToFriend(friendId, messageText)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, messageId: result.messageId }, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: String(error) }, null, 2),
            },
          ],
          isError: true,
        }
      }
    },
  )
}
