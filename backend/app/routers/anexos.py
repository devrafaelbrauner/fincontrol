import hashlib
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..db import DATA_DIR, get_db

UPLOADS_DIR = DATA_DIR / "uploads"
TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024

TIPOS_PERMITIDOS = {
    "application/pdf": ("pdf", ".pdf"),
    "image/jpeg": ("imagem", ".jpg"),
    "image/png": ("imagem", ".png"),
    "image/heic": ("imagem", ".heic"),
    "image/webp": ("imagem", ".webp"),
}
EXTENSAO_PARA_CONTENT_TYPE = {ext: content_type for content_type, (_, ext) in TIPOS_PERMITIDOS.items()}

router = APIRouter(prefix="/anexos", tags=["anexos"])


@router.post("", status_code=201)
def enviar(arquivo: UploadFile, db: sqlite3.Connection = Depends(get_db)):
    info = TIPOS_PERMITIDOS.get(arquivo.content_type)
    if not info:
        raise HTTPException(415, "Tipo de arquivo não suportado (use PDF, JPEG, PNG, HEIC ou WEBP)")
    tipo, extensao = info

    conteudo = arquivo.file.read()
    if len(conteudo) > TAMANHO_MAXIMO_BYTES:
        raise HTTPException(413, "Arquivo maior que 15 MB")
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio")

    hash_sha256 = hashlib.sha256(conteudo).hexdigest()
    nome_disco = f"{hash_sha256}{extensao}"
    caminho = UPLOADS_DIR / nome_disco

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    if not caminho.exists():
        caminho.write_bytes(conteudo)

    cur = db.execute(
        """INSERT INTO anexos (tipo, caminho_arquivo, nome_original, tamanho_bytes)
           VALUES (?, ?, ?, ?)""",
        (tipo, nome_disco, arquivo.filename or nome_disco, len(conteudo)),
    )
    return {"id": cur.lastrowid, "tipo": tipo, "nome_original": arquivo.filename, "tamanho_bytes": len(conteudo)}


@router.get("/{anexo_id}")
def baixar(anexo_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT * FROM anexos WHERE id = ?", (anexo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Anexo não encontrado")
    caminho = UPLOADS_DIR / row["caminho_arquivo"]
    if not caminho.exists():
        raise HTTPException(404, "Arquivo não encontrado no disco")
    extensao = Path(row["caminho_arquivo"]).suffix
    media_type = EXTENSAO_PARA_CONTENT_TYPE.get(extensao, "application/octet-stream")
    return FileResponse(caminho, media_type=media_type, filename=row["nome_original"])


@router.delete("/{anexo_id}")
def excluir(anexo_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT * FROM anexos WHERE id = ?", (anexo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Anexo não encontrado")

    em_uso = db.execute(
        "SELECT 1 FROM lancamentos_fixos WHERE anexo_id = ? UNION SELECT 1 FROM lancamentos_variaveis WHERE anexo_id = ?",
        (anexo_id, anexo_id),
    ).fetchone()
    if em_uso:
        raise HTTPException(409, "Anexo está vinculado a um lançamento — desvincule antes de excluir")

    db.execute("DELETE FROM anexos WHERE id = ?", (anexo_id,))
    outros_usos = db.execute(
        "SELECT 1 FROM anexos WHERE caminho_arquivo = ?", (row["caminho_arquivo"],)
    ).fetchone()
    if not outros_usos:
        caminho = UPLOADS_DIR / row["caminho_arquivo"]
        caminho.unlink(missing_ok=True)
    return {"ok": True}
