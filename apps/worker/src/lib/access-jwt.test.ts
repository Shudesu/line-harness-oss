import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { accessConfig, verifyAccessJwt } from './access-jwt.js';

afterEach(()=>vi.unstubAllGlobals());
describe('optional Access JWT validation',()=>{
  it('rejects absent configuration and untrusted team domains without fetching',async()=>{
    const network=vi.fn();vi.stubGlobal('fetch',network);
    expect(accessConfig({})).toBeNull();
    for(const domain of ['https://attacker.test','test.cloudflareaccess.com/path','test.cloudflareaccess.com.attacker.test']) {
      expect(await verifyAccessJwt('forged',{ACCESS_TEAM_DOMAIN:domain,ACCESS_AUD:'app'})).toBeNull();
    }
    expect(network).not.toHaveBeenCalled();
  });
  it('verifies signature, issuer, audience, expiry, not-before and algorithm against synthetic JWKS',async()=>{
    const {privateKey,publicKey}=await generateKeyPair('RS256');
    const jwk=await exportJWK(publicKey);jwk.kid='test-key';jwk.alg='RS256';
    const network=vi.fn(async(_input: unknown)=>new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}}));
    vi.stubGlobal('fetch',network);
    const env={ACCESS_TEAM_DOMAIN:'synthetic-team.cloudflareaccess.com',ACCESS_AUD:'test-audience'};
    const issuer='https://'+env.ACCESS_TEAM_DOMAIN;
    const now=Math.floor(Date.now()/1000);
    const issue=(claims: Record<string,unknown>={})=>new SignJWT({email:'staff@example.test',iss:issuer,aud:env.ACCESS_AUD,iat:now,exp:now+300,...claims}).setProtectedHeader({alg:'RS256',kid:'test-key'}).sign(privateKey);
    const valid=await issue();expect(await verifyAccessJwt(valid,env)).toEqual({email:'staff@example.test',exp:now+300});
    for(const claims of [{iss:'https://attacker.test'},{aud:'wrong'},{exp:now-1},{nbf:now+300},{iat:now+300},{email:undefined}]) expect(await verifyAccessJwt(await issue(claims),env)).toBeNull();
    const parts=valid.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
    expect(await verifyAccessJwt(parts.join('.'),env)).toBeNull();
    expect(await verifyAccessJwt('eyJhbGciOiJub25lIn0.e30.',env)).toBeNull();
    expect(network).toHaveBeenCalledTimes(1);
    expect(String(network.mock.calls[0]?.[0])).toBe(issuer+'/cdn-cgi/access/certs');
  });
});
