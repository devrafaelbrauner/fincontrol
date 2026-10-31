package com.rafaelbrauner.fincontrol

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * SECRET_KEY e FERNET_KEY do backend local, como o cofre da casca do desktop
 * (`sidecar.rs:604-620`), num formato que o `desktop.validar_segredos` aceita.
 *
 * Sorteados no 1º uso e gravados só cifrados (AES-256-GCM, o nome da entrada como AAD) nas
 * SharedPreferences privadas, fora de `files/`. A chave AES nasce no AndroidKeyStore, não sai
 * dele e não exige autenticação do usuário: o backend sobe sem desbloqueio, e uma digital nova
 * não a invalida (K3). Gera e grava só quando a entrada não existe; qualquer outra falha
 * (chave sumida, texto cifrado que não abre) vira erro e nunca segredo novo: uma Fernet nova
 * deixaria ilegível o que o banco já cifrou. Os valores só vão da casca para o Python, nunca
 * para log, JS ou disco em claro.
 */
internal object CofreBackend {

    class Falha(motivo: String) : Exception(motivo)

    /** `gerados`: o 1º uso acabou de sortear e gravar (senão, foram lidos do cofre). */
    class Segredos(val secretKey: String, val fernetKey: String, val gerados: Boolean)

    private const val PREFERENCIAS = "fincontrol_cofre"
    private const val CHAVE_SECRET = "backend_secret_key"
    private const val CHAVE_FERNET = "backend_fernet_key"
    private const val ALIAS = "fincontrol-backend-cofre"
    private const val LOJA = "AndroidKeyStore"
    private const val CIFRA = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    private val aleatorio = SecureRandom()

    @Synchronized
    fun segredos(contexto: Context): Segredos {
        try {
            val preferencias = contexto.getSharedPreferences(PREFERENCIAS, Context.MODE_PRIVATE)
            val novos = mutableMapOf<String, String>()
            val secret = ler(preferencias, CHAVE_SECRET)
                ?: hex(sortear(32)).also { novos[CHAVE_SECRET] = cifrar(CHAVE_SECRET, it) }
            val fernet = ler(preferencias, CHAVE_FERNET)
                ?: Base64.encodeToString(sortear(32), Base64.URL_SAFE or Base64.NO_WRAP)
                    .also { novos[CHAVE_FERNET] = cifrar(CHAVE_FERNET, it) }
            if (novos.isNotEmpty()) {
                val edicao = preferencias.edit()
                novos.forEach { (nome, cifrado) -> edicao.putString(nome, cifrado) }
                // commit, não apply: a Fernet só pode cifrar o banco depois de gravada.
                if (!edicao.commit()) throw Falha("não gravou os segredos cifrados")
            }
            return Segredos(secret, fernet, gerados = novos.isNotEmpty())
        } catch (e: GeneralSecurityException) {
            throw Falha("AndroidKeyStore recusou a operação (${e.javaClass.simpleName})")
        }
    }

    /** O segredo gravado, decifrado; null só se a entrada não existe. */
    private fun ler(preferencias: SharedPreferences, nome: String): String? {
        val gravado = preferencias.getString(nome, null) ?: return null
        val chave = chave(criar = false) ?: throw Falha("a chave do AndroidKeyStore sumiu e $nome não abre")
        val bytes = try {
            Base64.decode(gravado, Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
            throw Falha("$nome gravado está corrompido")
        }
        if (bytes.size <= IV_BYTES) throw Falha("$nome gravado está corrompido")
        // nosemgrep: kotlin.lang.security.gcm-detection.gcm-detection — decifra com o IV gravado junto; cada cifra sorteia um novo
        val cifra = Cipher.getInstance(CIFRA).apply { init(Cipher.DECRYPT_MODE, chave, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES)) }
        cifra.updateAAD(nome.toByteArray(Charsets.UTF_8))
        return String(cifra.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
    }

    /** IV (12 bytes, sorteado pelo KeyStore) + texto cifrado com a tag, em base64. */
    private fun cifrar(nome: String, valor: String): String {
        // nosemgrep: kotlin.lang.security.gcm-detection.gcm-detection — IV novo a cada cifra, sorteado pelo AndroidKeyStore (nunca reusado)
        val cifra = Cipher.getInstance(CIFRA).apply { init(Cipher.ENCRYPT_MODE, chave(criar = true)) }
        cifra.updateAAD(nome.toByteArray(Charsets.UTF_8))
        val cifrado = cifra.doFinal(valor.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cifra.iv + cifrado, Base64.NO_WRAP)
    }

    private fun chave(criar: Boolean): SecretKey? {
        val loja = KeyStore.getInstance(LOJA).apply { load(null) }
        (loja.getKey(ALIAS, null) as SecretKey?)?.let { return it }
        if (!criar) return null
        val gerador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, LOJA)
        gerador.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return gerador.generateKey()
    }

    private fun sortear(n: Int) = ByteArray(n).also(aleatorio::nextBytes)

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
}
