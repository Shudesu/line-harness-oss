"""One read-only GraphQL request; no database scans, writes or notifications.

Supply an existing authorized CLOUDFLARE_API_TOKEN in the environment. Never
create a token, refresh credentials or retry a rejected request here.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.request


def evaluate(account_rows, wallets, rows_per_wallet_limit, hourly_rows_limit):
    if account_rows is None:
        return {"status": "unknown", "reason": "No account metric returned; this is not zero usage"}
    reads = account_rows.get("rowsRead")
    writes = account_rows.get("rowsWritten")
    if not all(isinstance(n, (int, float)) and n >= 0 for n in (reads, writes)):
        return {"status": "unknown", "reason": "Missing billing row metrics"}
    if len(wallets) >= 100:
        return {"status": "unknown", "reason": "Wallet query groups reached the result limit"}
    alerts = []
    if hourly_rows_limit is not None and reads > hourly_rows_limit:
        alerts.append("account_hourly_read_budget")
    if any(not isinstance(g.get('count'), (int,float)) or g['count'] < 0
           or not isinstance(g.get('sum',{}).get('rowsRead'), (int,float)) or g['sum']['rowsRead'] < 0 for g in wallets):
        return {"status":"unknown", "reason":"Invalid wallet metric"}
    query_count = sum(g["count"] for g in wallets)
    query_reads = sum(g["sum"]["rowsRead"] for g in wallets)
    average = query_reads / query_count if query_count else None
    largest_average = max((g['sum']['rowsRead']/g['count'] for g in wallets if g['count']), default=None)
    if largest_average is not None and rows_per_wallet_limit is not None and largest_average > rows_per_wallet_limit:
        alerts.append("wallet_rows_per_execution")
    # No SQL text, identities, parameters or tokens leave this collector.
    return {"status": "alert" if alerts else "observed", "alerts": alerts,
            "rowsRead": reads, "rowsWritten": writes, "walletExecutions": query_count,
            "walletRowsRead": query_reads, "walletRowsPerExecution": average,
            "largestQueryGroupRowsPerExecution": largest_average,
            "walletAssessment": "measured" if average is not None else "unobserved",
            "budgetConfigured": hourly_rows_limit is not None,
            "note": "Adaptive analytics can be delayed/sampled. Alerts are not a spending cap. CPU/request billing requires separate Workers metrics."}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--account', required=True)
    p.add_argument('--database')
    p.add_argument('--wallet-pattern', required=True, help='Reviewed normalized SQL pattern, no customer parameters')
    p.add_argument('--rows-per-wallet-limit', type=float)
    p.add_argument('--hourly-rows-limit', type=float)
    args = p.parse_args()
    if not re.fullmatch(r'[a-f0-9]{32}', args.account): p.error('Invalid account ID')
    if args.database and not re.fullmatch(r'[a-f0-9-]{36}', args.database): p.error('Invalid database ID')
    if any(n is not None and (not 0 < n < float('inf')) for n in [args.rows_per_wallet_limit, args.hourly_rows_limit]): p.error('Thresholds must be finite positive numbers')
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token: p.error('Existing authorized CLOUDFLARE_API_TOKEN required')
    # Finish ten minutes in the past to avoid treating the newest bucket as final.
    end = datetime.datetime.now(datetime.timezone.utc).replace(second=0, microsecond=0) - datetime.timedelta(minutes=10)
    start = end - datetime.timedelta(hours=1)
    stamp = lambda d: d.isoformat().replace('+00:00', 'Z')
    time_filter = 'datetime_geq:'+json.dumps(stamp(start))+',datetime_lt:'+json.dumps(stamp(end))
    wallet_filter = time_filter+',query_like:'+json.dumps(args.wallet_pattern)+',query_notlike:"%EXPLAIN%"'
    if args.database: wallet_filter += ',databaseId:'+json.dumps(args.database)
    query = '{viewer{accounts(filter:{accountTag:'+json.dumps(args.account)+'}){'
    query += 'd1AnalyticsAdaptiveGroups(limit:1,filter:{'+time_filter+'}){sum{rowsRead rowsWritten}} '
    query += 'd1QueriesAdaptiveGroups(limit:100,filter:{'+wallet_filter+'}){count sum{rowsRead} dimensions{query}}}}}'
    request = urllib.request.Request('https://api.cloudflare.com/client/v4/graphql',
        data=json.dumps({'query':query}).encode(), headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response: data=json.load(response)
        if data.get('errors'): raise ValueError('GraphQL rejected the metric query')
        accounts=data['data']['viewer']['accounts']
        if len(accounts)!=1: raise ValueError('Expected one authorized account')
        groups=accounts[0]['d1AnalyticsAdaptiveGroups']
        result=evaluate(groups[0]['sum'] if groups else None,accounts[0]['d1QueriesAdaptiveGroups'],args.rows_per_wallet_limit,args.hourly_rows_limit)
    except Exception as error:
        # Error bodies can contain request details. Return only a classification.
        result={'status':'unknown','reason':type(error).__name__,'action':'Do not interpret missing metrics as zero or retry writes; check existing access and collector schema.'}
    print(json.dumps({'window':[stamp(start),stamp(end)],'observedAt':stamp(datetime.datetime.now(datetime.timezone.utc)),**result}))
    return 2 if result['status']=='unknown' else 1 if result['status']=='alert' else 0


if __name__ == '__main__': sys.exit(main())
