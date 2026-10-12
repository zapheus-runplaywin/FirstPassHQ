import AsyncStorage from '@react-native-async-storage/async-storage';
import aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Where the sign-in session (including its long-lived refresh token) is kept
 * on the phone. The session itself is too big for the keychain, so it is
 * encrypted (AES-256-CTR) with a key that lives in the keychain, and the
 * encrypted text goes in AsyncStorage. Reading the files from a backup or a
 * rooted phone gives nothing without the key. Supabase's "LargeSecureStore"
 * pattern; one key per session entry, named after it.
 */
export class SecureSessionStore {
  private keyName(key: string) {
    // SecureStore keys may only contain letters, digits, ".", "-" and "_".
    return key.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  private async encrypt(key: string, value: string) {
    const encryptionKey = Crypto.getRandomValues(new Uint8Array(32));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(this.keyName(key), aesjs.utils.hex.fromBytes(encryptionKey), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    return aesjs.utils.hex.fromBytes(encrypted);
  }

  private async decrypt(key: string, value: string) {
    const hexKey = await SecureStore.getItemAsync(this.keyName(key));
    if (!hexKey) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(hexKey),
      new aesjs.Counter(1),
    );
    const decrypted = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decrypted);
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    // Sessions saved by earlier versions were plain JSON: keep them, encrypted.
    if (encrypted.startsWith('{')) {
      await this.setItem(key, encrypted).catch(() => {});
      return encrypted;
    }
    try {
      return await this.decrypt(key, encrypted);
    } catch {
      // The key is gone (for example after a restore to another phone), so the
      // saved session can't be read: the member signs in again.
      await this.removeItem(key).catch(() => {});
      return null;
    }
  }

  async setItem(key: string, value: string) {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(this.keyName(key));
  }
}
