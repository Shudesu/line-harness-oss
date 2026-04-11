/**
 * Re-export the external API client for MCP server context.
 *
 * The MCP server runs in Node.js (not CF Workers), so we re-export
 * from the shared external-api module. If your MCP server needs
 * different configuration (e.g., different base URL for dev),
 * customize this file.
 */

export { MyServiceClient } from '../src/external-api.js'
export type { Customer, Appointment, Membership } from '../src/external-api.js'
