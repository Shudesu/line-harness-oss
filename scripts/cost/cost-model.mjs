// Planning estimate only; never substitutes local SQLite VM steps for D1 rows.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const pricing = {
  checkedOn: '2026-11-01', currency: 'USD',
  sources: [
    'https://developers.cloudflare.com/d1/platform/pricing/',
    'https://developers.cloudflare.com/workers/platform/pricing/',
    'https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/',
  ],
  d1: {readsIncluded: 25e9, writesIncluded: 50e6, readPerMillion: 0.001, writePerMillion: 1},
  standard: {requestsIncluded: 10e6, cpuMsIncluded: 30e6},
  wfp: {requestsIncluded: 20e6, cpuMsIncluded: 60e6},
  requestPerMillion: 0.30, cpuMsPerMillion: 0.02,
};
const keys=['rowsRead','rowsWritten','requests','cpuMs'];
function units(value) {
  if(!value || keys.some(k=>!Number.isFinite(value[k]) || value[k]<0)) throw Error('All four usage units must be explicit, finite and nonnegative');
  return value;
}
function metered(plan, usage) {
  const p=pricing[plan];if(!p || !['standard','wfp'].includes(plan))throw Error('Choose standard or wfp explicitly');
  units(usage);
  return Math.max(0,usage.rowsRead-pricing.d1.readsIncluded)/1e6*pricing.d1.readPerMillion
    + Math.max(0,usage.rowsWritten-pricing.d1.writesIncluded)/1e6*pricing.d1.writePerMillion
    + Math.max(0,usage.requests-p.requestsIncluded)/1e6*pricing.requestPerMillion
    + Math.max(0,usage.cpuMs-p.cpuMsIncluded)/1e6*pricing.cpuMsPerMillion;
}
export function project(input) {
  if(!['d1_meta_or_graphql','explicit_assumption'].includes(input.evidence))throw Error('D1 rows or an explicit assumption required; VM instructions are not billing units');
  const before=units(input.otherMonthlyAccountUsage), per=units(input.perInvocation);
  if(!Number.isFinite(input.monthlyInvocations)||input.monthlyInvocations<0)throw Error('monthlyInvocations required');
  if(!Number.isFinite(input.readRowsGrowthFactor)||input.readRowsGrowthFactor<1)throw Error('readRowsGrowthFactor required (1 for unrelated-data growth after indexed scope)');
  return {currency:'USD',evidence:input.evidence,pricingCheckedOn:pricing.checkedOn,
    exclusions:'subscription, storage, script/database counts, other services, taxes, exchange rates',
    scenarios:[1,100,1000].map(scale=>{
      const usage=Object.fromEntries(keys.map(k=>[k,per[k]*input.monthlyInvocations*scale*(k==='rowsRead'?input.readRowsGrowthFactor:1)]));
      const combined=Object.fromEntries(keys.map(k=>[k,before[k]+usage[k]]));
      return {invocationScale:scale,usage,marginalMeteredUsd:metered(input.plan,combined)-metered(input.plan,before)};
    })};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.argv[2])throw Error('Usage: node scripts/cost/cost-model.mjs reviewed-input.json');
  console.log(JSON.stringify(project(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
}
