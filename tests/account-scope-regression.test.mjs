import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('packages/db/schema.sql');
function tableBlock(name) {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${name}`);
  assert.notEqual(start, -1, `${name} table must exist`);
  const end = schema.indexOf('\n);', start);
  assert.notEqual(end, -1, `${name} table must close`);
  return schema.slice(start, end + 3);
}

const friendsBlock = tableBlock('friends');
assert.doesNotMatch(friendsBlock, /line_user_id\s+TEXT\s+UNIQUE\s+NOT NULL/, 'same LINE user id must be allowed in different LINE accounts');
assert.match(friendsBlock, /line_account_id\s+TEXT/, 'friends must carry line_account_id');
assert.match(schema, /idx_friends_line_user_account_unique ON friends \(line_user_id, line_account_id\)/, 'friends must be unique per LINE account');

const tagsBlock = tableBlock('tags');
assert.doesNotMatch(tagsBlock, /name\s+TEXT\s+UNIQUE\s+NOT NULL/, 'same tag name must be allowed in different LINE accounts');
assert.match(tagsBlock, /line_account_id\s+TEXT/, 'tags must carry line_account_id');
assert.match(schema, /idx_tags_account_name_unique ON tags \(line_account_id, name\)/, 'tags must be unique per LINE account');

const scenariosBlock = tableBlock('scenarios');
assert.match(scenariosBlock, /line_account_id\s+TEXT/, 'scenarios must belong to a LINE account');

const friends = read('packages/db/src/friends.ts');
assert.match(friends, /getFriendByLineUserId\(\s*db:\s*D1Database,\s*lineUserId:\s*string,\s*lineAccountId\?:/s, 'friend lookup must accept account scope');
assert.match(friends, /WHERE line_user_id = \? AND line_account_id = \?/s, 'friend lookup must filter by line_account_id when provided');
assert.match(friends, /INSERT INTO friends \([^)]*line_account_id/s, 'friend insert must persist line_account_id');

const tags = read('packages/db/src/tags.ts');
assert.match(tags, /getTags\(db:\s*D1Database,\s*lineAccountId\?:/s, 'tag listing must accept account scope');
assert.match(tags, /WHERE line_account_id = \?/s, 'tag listing must filter by line_account_id');
assert.match(tags, /INSERT INTO tags \([^)]*line_account_id/s, 'tag creation must persist line_account_id');

const scenarios = read('packages/db/src/scenarios.ts');
assert.match(scenarios, /getScenarios\(db:\s*D1Database,\s*lineAccountId\?:/s, 'scenarios listing must accept lineAccountId');
assert.match(scenarios, /WHERE s\.line_account_id = \?/s, 'scenarios listing must scope by account');

const webhook = read('apps/worker/src/routes/webhook.ts');
assert.match(webhook, /upsertFriend\(db, \{[\s\S]*lineAccountId,/s, 'webhook follow must upsert friend with account scope');
assert.doesNotMatch(webhook, /line_account_id IS NULL OR line_account_id = \?/s, 'auto replies must not include global/unassigned replies when account is known');
assert.doesNotMatch(webhook, /!scenario\.line_account_id \|\| !lineAccountId \|\| scenario\.line_account_id === lineAccountId/s, 'friend_add scenarios must not include global/unassigned scenarios when account is known');

const eventBus = read('apps/worker/src/services/event-bus.ts');
assert.doesNotMatch(eventBus, /!a\.line_account_id \|\| !lineAccountId \|\| a\.line_account_id === lineAccountId/s, 'automations must not include global/unassigned rules when account is known');
assert.doesNotMatch(eventBus, /!r\.line_account_id \|\| !lineAccountId \|\| r\.line_account_id === lineAccountId/s, 'notifications must not include global/unassigned rules when account is known');
assert.match(eventBus, /SELECT line_user_id FROM friends WHERE id = \? AND line_account_id = \?/s, 'automation actions must filter friends by line_account_id');

console.log('account scope regression checks passed');
