"""Gera um par de chaves VAPID para Web Push.

Uso: cd backend && .venv/bin/python -m app.gerar_vapid
Copie as duas linhas para o ambiente do backend (FINCONTROL_VAPID_PUBLIC/PRIVATE).
"""

from py_vapid import Vapid


def main() -> None:
    v = Vapid()
    v.generate_keys()
    # applicationServerKey (público, base64url sem padding) e chave privada (base64url).
    publica = v.public_key.public_bytes(
        encoding=__import__("cryptography").hazmat.primitives.serialization.Encoding.X962,
        format=__import__("cryptography").hazmat.primitives.serialization.PublicFormat.UncompressedPoint,
    )
    import base64

    pub_b64 = base64.urlsafe_b64encode(publica).rstrip(b"=").decode()
    priv_b64 = v.private_key.private_numbers().private_value.to_bytes(32, "big")
    priv_b64 = base64.urlsafe_b64encode(priv_b64).rstrip(b"=").decode()
    print(f"FINCONTROL_VAPID_PUBLIC={pub_b64}")
    print(f"FINCONTROL_VAPID_PRIVATE={priv_b64}")


if __name__ == "__main__":
    main()
