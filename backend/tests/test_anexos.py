"""Anexo no disco: o caminho gravado não pode escapar do diretório de uploads."""
from app.db import connect


def test_baixar_recusa_path_traversal(autenticado):
    db = connect()
    cur = db.execute(
        "INSERT INTO anexos (tipo, caminho_arquivo, nome_original, tamanho_bytes) VALUES (?, ?, ?, ?)",
        ("pdf", "../../etc/passwd", "passwd.pdf", 1),
    )
    anexo_id = cur.lastrowid
    db.commit()
    db.close()

    r = autenticado.get(f"/api/anexos/{anexo_id}")
    assert r.status_code == 400
    assert "inválido" in r.json()["detail"].lower()
