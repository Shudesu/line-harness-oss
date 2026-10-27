-- LINE-first gate integration. Maintainer-assigned release migration.
CREATE TABLE x_gate_campaigns (
 gate_id TEXT PRIMARY KEY,connection_id TEXT NOT NULL,line_account_id TEXT NOT NULL,
 slug TEXT NOT NULL,title TEXT NOT NULL,tier TEXT NOT NULL,tracked_link_id TEXT NOT NULL UNIQUE,
 tags TEXT NOT NULL,scenarios TEXT NOT NULL DEFAULT '{}',request_hash TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL
);
CREATE TABLE x_gate_entries (
 gate_id TEXT NOT NULL,friend_id TEXT NOT NULL,line_account_id TEXT NOT NULL,line_user_id TEXT NOT NULL,following INTEGER NOT NULL DEFAULT 0,participant_id TEXT,
 state TEXT NOT NULL DEFAULT 'entered',result TEXT,challenge_at INTEGER,reward_reply_at INTEGER,last_seen_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(gate_id,friend_id)
);
CREATE TABLE friend_external_ids (
 id TEXT PRIMARY KEY,friend_id TEXT NOT NULL,line_account_id TEXT NOT NULL,provider TEXT NOT NULL,
 external_id TEXT NOT NULL,username TEXT,linked_at INTEGER NOT NULL,source_gate_id TEXT NOT NULL,method TEXT NOT NULL,
 UNIQUE(friend_id,provider,source_gate_id),UNIQUE(line_account_id,provider,external_id,source_gate_id)
);
CREATE TABLE x_gate_inbox (
 delivery_id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,event TEXT NOT NULL,payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',lease_until INTEGER,owner TEXT,created_at INTEGER NOT NULL,
 last_error TEXT,completed_at INTEGER
);
CREATE TABLE x_gate_outbox (
 id TEXT PRIMARY KEY,gate_id TEXT NOT NULL,friend_id TEXT NOT NULL,type TEXT NOT NULL,source_id TEXT NOT NULL,
 payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 last_error TEXT,lease_until INTEGER,owner TEXT,UNIQUE(gate_id,friend_id,type,source_id)
);
CREATE TABLE x_gate_reply_receipts (
 source_id TEXT PRIMARY KEY,friend_id TEXT NOT NULL,gate_id TEXT NOT NULL,status TEXT NOT NULL,reward_response INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX x_gate_entry_line_identity ON x_gate_entries(gate_id,line_user_id);

-- Elect one automatic result delivery path before any network send.
CREATE TABLE x_gate_notifications (
 gate_id TEXT NOT NULL,friend_id TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('reply','push')),
 delivery_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,
 PRIMARY KEY(gate_id,friend_id)
);
