// Synthetic authenticator for protocol tests, never shipped in the Worker.
import {
  generateKeyPairSync,
  createHash,
  randomBytes,
  sign,
} from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
export function syntheticAuthenticator(rpId: string, origin: string) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const id = randomBytes(32);
  let userHandle = '';
  const hash = (value: string | Uint8Array) =>
    createHash('sha256').update(value).digest();
  const cose = isoCBOR.encode(
    new Map<any, any>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
    ]),
  );
  return {
    register(options: any) {
      userHandle = options.user.id;
      const client = Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: options.challenge,
          origin,
          crossOrigin: false,
        }),
      );
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      const auth = Buffer.concat([
        hash(rpId),
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        length,
        id,
        cose,
      ]);
      const attestation = isoCBOR.encode(
        new Map<any, any>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', new Uint8Array(auth)],
        ]),
      );
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: b64(client),
          attestationObject: b64(attestation),
          transports: ['internal'],
        },
      };
    },
    login(
      options: any,
      overrides: {
        origin?: string;
        rpId?: string;
        uv?: boolean;
        counter?: number;
        challenge?: string;
      } = {},
    ) {
      const client = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: overrides.challenge ?? options.challenge,
          origin: overrides.origin ?? origin,
          crossOrigin: false,
        }),
      );
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(overrides.counter ?? 1);
      const auth = Buffer.concat([
        hash(overrides.rpId ?? rpId),
        Buffer.from([overrides.uv === false ? 1 : 5]),
        counter,
      ]);
      const signature = sign(
        'sha256',
        Buffer.concat([auth, hash(client)]),
        pair.privateKey,
      );
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(auth),
          signature: b64(signature),
          userHandle,
        },
      };
    },
  };
}
