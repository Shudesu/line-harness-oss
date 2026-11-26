/** Release keys must be provisioned through the reviewed signing environment.
 * Never trust a public key supplied by the downloaded manifest or signature.
 * Empty until the first signing ceremony; warn mode reports unverified. */
export const TRUSTED_RELEASE_KEYS: Readonly<Record<string, string>> = Object.freeze({});
