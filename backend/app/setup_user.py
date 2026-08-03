"""Configura (ou redefine) a senha e o 2FA do usuário único.

Uso: cd backend && .venv/bin/python -m app.setup_user
"""

import getpass
import sys

import pyotp
from argon2 import PasswordHasher

from .auth import SENHA_MINIMA, _validar_senha
from .db import connect, migrate


def main() -> None:
    migrate()
    # A política é a do app (auth._validar_senha), não uma cópia: com um mínimo
    # próprio aqui, este script aceitaria senha que a tela recusa — ou o contrário.
    senha = getpass.getpass(f"Nova senha (mín. {SENHA_MINIMA} caracteres, com letra, número e especial): ")
    problema = _validar_senha(senha)
    if problema:
        sys.exit(problema)
    if getpass.getpass("Confirme a senha: ") != senha:
        sys.exit("As senhas não conferem.")

    conn = connect()
    upsert = "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor"
    conn.execute(upsert, ("senha_hash", PasswordHasher().hash(senha)))

    if input("Ativar 2FA (TOTP)? [S/n] ").strip().lower() != "n":
        secret = pyotp.random_base32()
        conn.execute(upsert, ("totp_secret", secret))
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name="dono", issuer_name="FinControl")
        print("\nAdicione ao seu app autenticador (Google Authenticator, 1Password etc.):")
        print(f"  {uri}")
        print(f"  (secret manual: {secret})")
    else:
        conn.execute("DELETE FROM config WHERE chave = 'totp_secret'")
        print("2FA desativado.")

    conn.commit()
    conn.close()
    print("\nUsuário configurado.")


if __name__ == "__main__":
    main()
