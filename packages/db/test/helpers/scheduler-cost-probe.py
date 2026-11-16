"""Synthetic in-memory measurement of the per-minute scheduler queries.

VM instructions are NOT D1 billable rows; they are a deterministic local proxy
for "how much of the table this statement touches". The SQL is captured from the
production helpers; the schema is the repository bootstrap. No network,
credentials or production data.
"""
import json
import sqlite3
import sys

spec = json.load(sys.stdin)
NOW = spec['now']


def measure(db, query):
    steps = 0

    def progress():
        nonlocal steps
        steps += 1
        return 0

    db.set_progress_handler(progress, 1)
    rows = db.execute(query['sql'], query['params']).fetchall()
    db.set_progress_handler(None, 0)
    return steps, len(rows)


def fixture(scale):
    db = sqlite3.connect(':memory:')
    db.executescript(spec['schema'])
    db.execute("INSERT INTO scenarios (id, name, trigger_type, is_active) VALUES ('sc-on','on','manual',1),('sc-off','off','manual',0)")
    n = 100 * scale
    db.executemany("INSERT INTO friends (id, line_user_id) VALUES (?, ?)",
                   ((f'f{i}', f'U{i}') for i in range(n + 10)))
    # Unrelated: active enrollments due in the future, completed ones, and an inactive scenario.
    db.executemany("INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at) VALUES (?,?,?,?,?)",
                   ((f'future{i}', f'f{i}', 'sc-on', 'active', '2099-01-01T00:00:00.000+09:00') for i in range(n)))
    db.executemany("INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at) VALUES (?,?,?,?,?)",
                   ((f'done{i}', f'f{i}', 'sc-off', 'completed', '2020-01-01T00:00:00.000+09:00') for i in range(n)))
    # Constant due set.
    db.executemany("INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at) VALUES (?,?,?,?,?)",
                   ((f'due{i}', f'f{n + i}', 'sc-on', 'active', '2026-01-01T00:00:00.000Z') for i in range(5)))
    # Broadcasts: many already-sent ones with insights; a constant 3 scheduled.
    db.executemany("INSERT INTO broadcasts (id, title, message_type, message_content, status, sent_at) VALUES (?,?,?,?,?,?)",
                   ((f'b{i}', 't', 'text', 'x', 'sent', '2026-01-01T00:00:00.000+09:00') for i in range(n)))
    db.executemany("INSERT INTO broadcast_insights (id, broadcast_id, status) VALUES (?,?,'ready')",
                   ((f'bi{i}', f'b{i}') for i in range(n)))
    db.executemany("INSERT INTO broadcasts (id, title, message_type, message_content, status, scheduled_at) VALUES (?,?,?,?,?,?)",
                   ((f's{i}', 't', 'text', 'x', 'scheduled', '2026-01-01T00:00:00.000+09:00') for i in range(3)))
    return db


report = {'unit': 'sqlite_vm_instructions_not_d1_rows', 'sqlite_version': sqlite3.sqlite_version, 'growth': []}
names = list(spec['queries'])
for scale in [1, 100, 1000]:
    db = fixture(scale)
    row = {'scale': scale}
    for name in names:
        vm, count = measure(db, spec['queries'][name])
        row[name] = vm
        row[name + '_rows'] = count
    for name in spec.get('legacy', {}):
        row['legacy_' + name] = measure(db, spec['legacy'][name])[0]
    if scale == 1000:
        plan = ' | '.join(r[3] for r in db.execute('EXPLAIN QUERY PLAN ' + spec['queries']['scenarios']['sql'], spec['queries']['scenarios']['params']))
        assert 'SCAN fs' not in plan, plan
        report['scenario_plan'] = plan
    report['growth'].append(row)
    db.close()

base = report['growth'][0]
for row in report['growth']:
    assert row['scenarios_rows'] == 5, row
    assert row['broadcasts_rows'] == 3, row
for row in report['growth'][1:]:
    for name in names:
        assert row[name] <= base[name] * 2 + 200, (name, row[name], base[name])
# Negative control: the previous queries grow with unrelated data.
big = report['growth'][-1]
for name in spec.get('legacy', {}):
    assert big['legacy_' + name] > base['legacy_' + name] * 50, (name, big['legacy_' + name], base['legacy_' + name])
print(json.dumps(report))
