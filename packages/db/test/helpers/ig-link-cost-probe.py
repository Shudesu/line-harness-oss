"""Synthetic in-memory measurements of SQL captured from the production helpers."""
import json
import sqlite3
import sys

spec = json.load(sys.stdin)

def measure(db, query):
    steps = 0
    def progress():
        nonlocal steps
        steps += 1
        return 0
    db.set_progress_handler(progress, 1)
    db.execute(query['sql'], query['params']).fetchall()
    db.set_progress_handler(None, 0)
    return steps

report = {'unit': 'sqlite_vm_instructions_not_d1_rows', 'scales': []}
for scale in [1, 100, 1000]:
    db = sqlite3.connect(':memory:')
    db.executescript(spec['schema'])
    db.executemany('INSERT INTO ig_link_token_uses VALUES (?,?,?,?)',
                   ((f'unrelated-{i}', 'synthetic-friend', 0, 9999) for i in range(100 * scale)))
    db.executemany('INSERT INTO ig_link_token_uses VALUES (?,?,?,?)',
                   ((f'expired-{i}', 'synthetic-friend', 0, 1) for i in range(25)))
    vm = [measure(db, q) for q in spec['queries']]
    assert db.execute('SELECT count(*) FROM ig_link_token_uses WHERE expires_at <= 1000').fetchone()[0] == 0
    report['scales'].append({'scale': scale, 'vm': vm})
    if scale == 1000:
        db.execute('DROP INDEX idx_ig_link_token_uses_expires')
        missing = measure(db, spec['queries'][-1])
        assert missing > vm[-1] * 10, (missing, vm[-1])
        report['missing_index_vm'] = missing
    db.close()
for row in report['scales'][1:]:
    for actual, baseline in zip(row['vm'], report['scales'][0]['vm']):
        assert actual <= baseline * 2 + 200, (actual, baseline)
print(json.dumps(report))
