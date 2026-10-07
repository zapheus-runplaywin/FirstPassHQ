import * as ExpoCrypto from 'expo-crypto';
import { Platform } from 'react-native';

/**
 * React Native has no WebCrypto, so Supabase falls back to a "plain" PKCE
 * challenge (and Math.random for the verifier when `crypto` is missing).
 * Provide the two pieces it uses, backed by expo-crypto, so sign-in uses a
 * SHA-256 challenge from secure random bytes. Browsers keep their own.
 */
if (Platform.OS !== 'web') {
  const g = globalThis as { crypto?: Partial<Crypto> };
  const existing = g.crypto ?? {};

  g.crypto = {
    ...existing,
    getRandomValues:
      existing.getRandomValues?.bind(existing) ??
      (<T extends ArrayBufferView | null>(array: T): T => {
        ExpoCrypto.getRandomValues(array as unknown as Uint8Array);
        return array;
      }),
    subtle:
      existing.subtle ??
      ({
        digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
          if (name.toUpperCase() !== 'SHA-256') {
            return Promise.reject(new Error(`Unsupported digest algorithm: ${name}`));
          }
          return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
        },
      } as SubtleCrypto),
  };
}
