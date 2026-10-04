package com.metaloid.core.storage

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.metaloid.core.common.MetaLog
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts/decrypts a blob with a key the app cannot read out of the device.
 *
 * Abstracted so the session store can be tested on the JVM (with a fake) while
 * the real implementation is the Android Keystore.
 */
interface SecretBox {
    fun encrypt(plaintext: ByteArray): ByteArray
    fun decrypt(payload: ByteArray): ByteArray
}

/**
 * AES-256-GCM under an Android Keystore key.
 *
 * Why not `androidx.security:security-crypto`: that library is deprecated, and
 * the reason it existed — "get encryption right without thinking" — is satisfied
 * here in ~60 lines with no dependency, no XML and no key material on disk.
 *
 * Properties that matter:
 *  * the key lives in the Keystore, is never exported and cannot be read by the
 *    app process (hardware-backed where the device supports it);
 *  * a fresh 12-byte IV per encryption, stored with the ciphertext — reusing an
 *    IV with GCM is a catastrophic failure mode, so it is never a parameter;
 *  * a decrypt failure (key invalidated by a device-lock change, restored
 *    backup, corrupted file) is reported as "no session", which is recoverable:
 *    the user signs in again instead of the app crashing on launch.
 */
class KeystoreSecretBox(
    private val alias: String = DEFAULT_ALIAS,
) : SecretBox {

    companion object {
        private const val TAG = "vault"
        private const val DEFAULT_ALIAS = "metaloid.session.v1"
        private const val PROVIDER = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LENGTH = 12
        private const val TAG_LENGTH_BITS = 128
    }

    override fun encrypt(plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        return iv + ciphertext
    }

    override fun decrypt(payload: ByteArray): ByteArray {
        require(payload.size > IV_LENGTH) { "payload too short" }
        val iv = payload.copyOfRange(0, IV_LENGTH)
        val ciphertext = payload.copyOfRange(IV_LENGTH, payload.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
        return cipher.doFinal(ciphertext)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        MetaLog.i(TAG, "generated session key in the keystore")
        return generator.generateKey()
    }
}

/**
 * A single small secret (the session) held in a file, always encrypted.
 *
 * The file holds base64 of `iv || ciphertext`. There is no plaintext mode and
 * no fallback: if encryption is unavailable, the session is simply not
 * persisted, which the callers treat as "signed out" — never as "store it in
 * the clear".
 */
class SecretFileVault(
    private val file: File,
    private val box: SecretBox,
) {

    fun read(): String? {
        if (!file.exists()) return null
        return try {
            val raw = Base64.decode(file.readBytes(), Base64.DEFAULT)
            String(box.decrypt(raw), Charsets.UTF_8)
        } catch (e: Exception) {
            // A vault that cannot be opened is a vault we do not have. Deleting
            // it turns "key invalidated after a device change" into a re-login
            // instead of a boot loop.
            MetaLog.w("vault", "stored session could not be read (${e.javaClass.simpleName}); clearing it")
            clear()
            null
        }
    }

    fun write(value: String) {
        runCatching {
            val payload = box.encrypt(value.toByteArray(Charsets.UTF_8))
            file.parentFile?.mkdirs()
            file.writeBytes(Base64.encode(payload, Base64.DEFAULT))
        }.onFailure {
            MetaLog.e("vault", "session could not be persisted", it)
        }
    }

    fun clear() {
        runCatching { if (file.exists()) file.delete() }
    }
}
