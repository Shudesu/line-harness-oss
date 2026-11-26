"""Local synthetic complexity check. VM instructions are NOT D1 billable rows.

Input SQL is captured by calling the production wallet helper, never copied here.
The schema is the repository's generated bootstrap, checked for drift in CI.
No network, credentials, production data, or wall-clock performance thresholds.
"""
import json
import sqlite3
import sys

payload = json.load(sys.stdin)


def fixture(unrelated, own):
    db = sqlite3.connect(":memory:", cached_statements=0)
    db.executescript(payload["schema"])
    db.execute("PRAGMA foreign_keys=ON")
    db.executemany("INSERT INTO users(id,display_name) VALUES (?,?)",
                   [("target-user", "Synthetic target"), ("noise-user", "Synthetic noise")])
    db.executemany("INSERT INTO friends(id,line_user_id,user_id) VALUES (?,?,?)",
                   [("target", "synthetic-target", "target-user"),
                    ("alias", "synthetic-alias", "target-user"),
                    ("empty", "synthetic-empty", None)])
    db.executemany("INSERT INTO friends(id,line_user_id,user_id) VALUES (?,?,?)",
                   ((f"noise-{i}", f"synthetic-noise-{i}", "noise-user") for i in range(unrelated)))
    db.execute("INSERT INTO mileage_programs(id,code,name,status,created_at,updated_at) VALUES ('default','default','Synthetic','active','2026-01-01','2026-01-01')")
    insert = """INSERT INTO mileage_ledger
      (id,program_id,beneficiary_user_id,beneficiary_friend_id,entry_type,status,
       amount,reason,source,idempotency_key,occurred_at,created_at)
      VALUES (?,'default',?,?,'grant','available',1,'synthetic','test',?,'2026-01-01','2026-01-01')"""
    # Alternate canonical and legacy linked-friend entries. Both belong to one wallet.
    db.executemany(insert, ((f"own-{i}", "target-user" if i % 2 else None,
                            "target" if i % 2 else "alias", f"own-{i}") for i in range(own)))
    db.executemany(insert, ((f"entry-{i}", "noise-user", f"noise-{i}", f"entry-{i}") for i in range(unrelated)))
    db.commit()
    return db


def measure(db, queries):
    steps = 0
    def tick():
        nonlocal steps
        steps += 100
        return int(steps > 30_000_000)  # Fail a runaway local query; never hide it.
    results, plans = [], []
    before = db.total_changes
    for query in queries:
        sql, params = query["sql"], query["params"]
        plans.extend(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + sql, params))
        db.set_progress_handler(tick, 100)
        try:
            cursor = db.execute(sql, params)
            if cursor.description:
                results.append(dict(zip([c[0] for c in cursor.description], cursor.fetchone())))
        finally:
            db.set_progress_handler(None, 0)
    assert db.total_changes == before, "An existing wallet read unexpectedly changed data"
    return {"vm_instructions_approx": steps, "query_count": len(queries),
            "result": results[-1], "plan": plans}


report = {"unit": "sqlite_vm_instructions_not_d1_rows", "sqlite_version": sqlite3.sqlite_version,
          "unrelated_growth": [], "own_history_growth": []}
for scale in [1, 100, 1000]:
    db = fixture(100 * scale, 24)
    target = measure(db, payload["queries"])
    assert target["result"]["available"] == 24
    empty = measure(db, payload["empty_queries"])
    assert empty["result"]["available"] == 0
    report["unrelated_growth"].append({"scale": scale, "unrelated_rows": 100 * scale,
                                       "target": target, "empty": empty})
    for scope in ["target", "empty"]:
        baseline = max(100, report["unrelated_growth"][0][scope]["vm_instructions_approx"])
        assert report["unrelated_growth"][-1][scope]["vm_instructions_approx"] <= baseline * 2, f"Unrelated-data scan: {scope}, {scale}x"
    if scale == 1000:
        # A real negative control: removing scope indexes must make this guard fail.
        db.executescript("DROP INDEX idx_mileage_ledger_friend; DROP INDEX idx_mileage_ledger_user; DROP INDEX idx_friends_user_id;")
        report["missing_index_control"] = measure(db, payload["queries"])
    db.close()
for scale in [1, 100, 1000]:
    db = fixture(100, 24 * scale)
    result = measure(db, payload["queries"])
    assert result["result"]["available"] == 24 * scale
    report["own_history_growth"].append({"scale": scale, "wallet_rows": 24 * scale, **result})
    db.close()

# A tenfold-or-greater tolerance would mask a scope regression. Allow only 2x
# for SQLite planner/VM differences while unrelated data grows 1000x.
baseline = max(100, report["own_history_growth"][0]["vm_instructions_approx"])
for item in report["own_history_growth"]:
    assert item["vm_instructions_approx"] <= baseline * item["scale"] * 2, "Superlinear wallet-history work"
assert report["missing_index_control"]["vm_instructions_approx"] > baseline * 20, "Negative control did not expose the scan"
print(json.dumps(report))
