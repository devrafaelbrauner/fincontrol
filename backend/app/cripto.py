"""Criptografia da chave do OpenRouter (Fernet).

A master key vive em variável de ambiente (FINCONTROL_FERNET_KEY), fora do repo e
do banco. Para dev, se não estiver setada, deriva-se de FINCONTROL_SECRET_KEY —
assim o app roda localmente sem configuração extra, mas produção deve definir uma
chave própria e estável (trocá-la torna as chaves já salvas ilegíveis).
"""

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken


def _master_key() -> bytes:
    explicita = os.environ.get("FINCONTROL_FERNET_KEY")
    if explicita:
        return explicita.encode()
    # Deriva uma chave Fernet válida (32 bytes url-safe base64) do SECRET_KEY.
    secret = os.environ.get("FINCONTROL_SECRET_KEY", "dev-insecure-troque-em-producao")
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())


def _fernet() -> Fernet:
    return Fernet(_master_key())


def criptografar(valor: str) -> str:
    return _fernet().encrypt(valor.encode()).decode()


def descriptografar(valor_enc: str) -> str | None:
    try:
        return _fernet().decrypt(valor_enc.encode()).decode()
    except InvalidToken:
        return None
