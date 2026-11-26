"""Local synthetic complexity check for the 6-hourly follow-milestone job.

Design memo (docs/engineering/cloudflare-cost-review.md):
- Entry: existing 6-hour cron -> enqueueFollowingMileageMilestones, shared DB,
  4 runs/day. No new caller, retry or polling.
- SQL per run: fixed at 12 (2 per milestone x 6 milestones), independent of
  the number of friends. Writes are capped by LIMIT (<= 2000 per statement).
- Read range: each event statement walks the following friends that are old
  enough for the milestone and probes engagement_events by primary key; each
  queue statement walks that milestone's events and probes the queue by
  primary key. This is linear in following friends and was already so before
  metadata.do_not_contact was read. The flag is read from the friends row the
  statement already visits (no extra table or index), and the queue statement
  only probes friends for events that have no queue row yet, so a caught-up
  database adds no probes there.
- Unmeasured: D1 billed rows and Workers CPU ms. SQLite VM instructions do not
  include the time spent inside json_valid/json_type/json_extract, so the
  per-row JSON parse is reported as wall-clock time for information only and
  is not asserted.

Input SQL is captured by calling the production helper, never copied here.
No network, credentials, production data, or wall-clock thresholds.
"""
import json
import sqlite3
import sys
import time

payload = json.load(sys.stdin)
NOW = payload["now"]
MILESTONES = len(payload["queries"]) // 2
FOLLOWED_AT = "2025-01-01T10:00:00.000+09:00"  # > 365 days before NOW: every milestone due


def fixture(friends):
    db = sqlite3.connect(":memory:", cached_statements=0)
    db.executescript(payload["schema"])
    db.execute("INSERT INTO mileage_programs(id,code,name,status,created_at,updated_at) VALUES ('default','default','Synthetic','active','2026-01-01','2026-01-01')")
    # 1 in 100 friends carries the flag; the rest have ordinary app metadata.
    db.executemany(
        """INSERT INTO friends(id,line_user_id,is_following,first_followed_at,
                               current_follow_started_at,last_followed_at,metadata)
           VALUES (?,?,1,?,?,?,?)""",
        ((f"f-{i}", f"synthetic-{i}", FOLLOWED_AT, FOLLOWED_AT, FOLLOWED_AT,
          json.dumps({"source": "synthetic", "segment": i % 7,
                      **({"do_not_contact": True} if i % 100 == 0 else {})}))
         for i in range(friends)))
    db.commit()
    return db


def run(db, queries, unlimited=False):
    """Execute one job run. Returns (vm_steps, rows_changed, seconds, plans)."""
    steps = 0
    def tick():
        nonlocal steps
        steps += 100
        return int(steps > 300_000_000)  # Fail a runaway local query; never hide it.
    plans = []
    before = db.total_changes
    started = time.perf_counter()
    for query in queries:
        params = list(query["params"])
        if unlimited:
            params[-1] = 1_000_000_000  # LIMIT is the last bind of both statements.
        plans.extend(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query["sql"], params))
        db.set_progress_handler(tick, 100)
        try:
            db.execute(query["sql"], params)
        finally:
            db.set_progress_handler(None, 0)
    db.commit()
    return steps, db.total_changes - before, time.perf_counter() - started, plans


report = {"unit": "sqlite_vm_instructions_not_d1_rows", "sqlite_version": sqlite3.sqlite_version,
          "query_count": len(payload["queries"]), "caught_up": [], "recovery_backlog": []}
for scale in [1, 100, 1000]:
    friends = 100 * scale
    db = fixture(friends)
    _, created, _, _ = run(db, payload["queries"], unlimited=True)
    contactable = friends - friends // 100
    assert created == contactable * MILESTONES * 2, f"Unexpected catch-up writes: {created}"
    flagged = db.execute(
        "SELECT COUNT(*) FROM engagement_events WHERE actor_friend_id IN ('f-0','f-100')").fetchone()[0]
    assert flagged == 0, "A flagged friend received a milestone"
    steps, changed, seconds, plans = run(db, payload["queries"])
    assert changed == 0, "A caught-up run wrote rows"
    assert not any("TEMP B-TREE" in plan and "friends" in plan for plan in plans)
    report["caught_up"].append({"scale": scale, "friends": friends, "vm_instructions_approx": steps,
                                "wall_ms_informational": round(seconds * 1000, 1)})
    # Recovery backlog that grows with the scale: 10% of friends lose their
    # queue rows and half of those opt out before the retry. This is the only
    # path that probes friends from the queue statement, so it is measured and
    # bounded separately. Unlimited binds: the per-run LIMIT would hide growth.
    db.execute("""DELETE FROM mileage_event_queue WHERE engagement_event_id IN (
                    SELECT ee.id FROM engagement_events ee JOIN friends f ON f.id = ee.actor_friend_id
                     WHERE CAST(substr(f.id, 3) AS INTEGER) % 10 = 1)""")
    db.execute("""UPDATE friends SET metadata = '{"do_not_contact": true}'
                   WHERE CAST(substr(id, 3) AS INTEGER) % 20 = 1""")
    db.commit()
    backlog_steps, recovered, _, _ = run(db, payload["queries"], unlimited=True)
    assert recovered == (friends // 20) * MILESTONES, f"Unexpected recovery writes: {recovered}"
    # The opt-out probe must reach friends by primary key, never by a scan.
    for query in payload["queries"][1::2]:
        queue_plan = [row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query["sql"], query["params"])]
        assert any(plan.startswith("SEARCH f ") for plan in queue_plan), queue_plan
        assert not any(plan.startswith("SCAN f") for plan in queue_plan), queue_plan
    report["recovery_backlog"].append({"scale": scale, "unqueued_events": (friends // 10) * MILESTONES,
                                       "requeued": recovered, "vm_instructions_approx": backlog_steps})
    db.close()

# The job is linear in following friends by design. Allow 2x for planner/VM
# differences; anything steeper means a per-friend scan was introduced.
baseline = max(100, report["caught_up"][0]["vm_instructions_approx"])
for item in report["caught_up"]:
    assert item["vm_instructions_approx"] <= baseline * item["scale"] * 2, "Superlinear milestone reconciliation"
backlog_baseline = max(100, report["recovery_backlog"][0]["vm_instructions_approx"])
for item in report["recovery_backlog"]:
    assert item["vm_instructions_approx"] <= backlog_baseline * item["scale"] * 2, "Superlinear milestone recovery"
print(json.dumps(report))
