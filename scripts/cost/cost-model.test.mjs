import test from 'node:test';
import assert from 'node:assert/strict';
import {project} from './cost-model.mjs';
const input={plan:'standard',evidence:'explicit_assumption',monthlyInvocations:1,
  readRowsGrowthFactor:1,perInvocation:{rowsRead:1e6,rowsWritten:1e6,requests:1e6,cpuMs:1e6},
  otherMonthlyAccountUsage:{rowsRead:25e9,rowsWritten:50e6,requests:10e6,cpuMs:30e6}};
test('charges marginal usage after the account allowance is consumed once',()=>{
  const r=project(input);assert.ok(Math.abs(r.scenarios[0].marginalMeteredUsd-1.321)<1e-8);
  assert.ok(Math.abs(r.scenarios[2].marginalMeteredUsd-1321)<1e-8);
});
test('does not assign each feature its own free allowance',()=>{
  const a=project({...input,perInvocation:{rowsRead:0,rowsWritten:0,requests:1e6,cpuMs:0}});
  assert.equal(a.scenarios[0].marginalMeteredUsd,0.3);
});
test('requires CPU and D1 units and rejects SQLite instruction counts',()=>{
  assert.throws(()=>project({...input,evidence:'sqlite_vm_instructions'}));
  assert.throws(()=>project({...input,perInvocation:{rowsRead:1}}));
  assert.throws(()=>project({...input,monthlyInvocations:Infinity}));
});
test('keeps WFP and standard allowances separate',()=>{
  const a=project({...input,plan:'wfp',perInvocation:{rowsRead:0,rowsWritten:0,requests:1e6,cpuMs:1e6}});
  assert.equal(a.scenarios[0].marginalMeteredUsd,0);
});
