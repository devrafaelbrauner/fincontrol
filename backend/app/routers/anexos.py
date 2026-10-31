import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse

from ..auth import MODO_DESKTOP, limiter
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

# O content_type do multipart é declarado pelo cliente (forjável); a assinatura
# dos primeiros bytes é o que garante que o conteúdo é mesmo do tipo dito.
ASSINATURAS = {
    "application/pdf": lambda b: b.startswith(b"%PDF-"),
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP",
    # Marcas ISO-BMFF que o iPhone emite: além das HEIC puras, sequências
    # (hevc/hevx, usadas em Live Photos e burst) e os contêineres mif1/msf1.
    "image/heic": lambda b: b[4:8] == b"ftyp" and b[8:12] in (
        b"heic", b"heix", b"heif", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1",
    ),
}
# Todo tipo aceito precisa de assinatura: sem isto, um tipo novo em
# TIPOS_PERMITIDOS entraria sem checagem de conteúdo (ou explodiria em KeyError).
assert set(ASSINATURAS) == set(TIPOS_PERMITIDOS), "assinatura faltando para algum tipo permitido"
EXTENSAO_PARA_CONTENT_TYPE = {ext: content_type for content_type, (_, ext) in TIPOS_PERMITIDOS.items()}

router = APIRouter(prefix="/anexos", tags=["anexos"])


def _caminho_confinado(relativo: str) -> Path:
    base = UPLOADS_DIR.resolve()
    caminho = (base / relativo).resolve()
    if not caminho.is_relative_to(base):
        raise HTTPException(400, "Caminho de anexo inválido")
    return caminho


@router.post("", status_code=201)
@limiter.limit("10/minute")
def enviar(request: Request, arquivo: UploadFile, db: sqlite3.Connection = Depends(get_db, scope="function")):
    info = TIPOS_PERMITIDOS.get(arquivo.content_type)
    if not info:
        raise HTTPException(415, "Tipo de arquivo não suportado (use PDF, JPEG, PNG, HEIC ou WEBP)")
    tipo, extensao = info

    # Lê no máximo o limite + 1 byte: se vier mais, o arquivo excede 15 MB e é
    # rejeitado sem carregar gigabytes na memória do processo.
    conteudo = arquivo.file.read(TAMANHO_MAXIMO_BYTES + 1)
    if len(conteudo) > TAMANHO_MAXIMO_BYTES:
        raise HTTPException(413, "Arquivo maior que 15 MB")
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio")
    if not ASSINATURAS[arquivo.content_type](conteudo):
        raise HTTPException(415, "O conteúdo do arquivo não corresponde ao tipo declarado")

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
def baixar(anexo_id: int, db: sqlite3.Connection = Depends(get_db, scope="function")):
    row = db.execute("SELECT * FROM anexos WHERE id = ?", (anexo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Anexo não encontrado")
    caminho = _caminho_confinado(row["caminho_arquivo"])
    if not caminho.exists():
        raise HTTPException(404, "Arquivo não encontrado no disco")
    extensao = Path(row["caminho_arquivo"]).suffix
    media_type = EXTENSAO_PARA_CONTENT_TYPE.get(extensao, "application/octet-stream")
    return FileResponse(caminho, media_type=media_type, filename=row["nome_original"])


@router.delete("/{anexo_id}")
def excluir(anexo_id: int, db: sqlite3.Connection = Depends(get_db, scope="function")):
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
        try:
            caminho = _caminho_confinado(row["caminho_arquivo"])
        except HTTPException:
            return {"ok": True}
        caminho.unlink(missing_ok=True)
    return {"ok": True}


def _abrir_no_sistema(caminho: Path) -> None:
    """Abre o arquivo no app padrão do sistema. Lista de argv, sem shell."""
    if sys.platform == "win32":
        os.startfile(caminho)  # type: ignore[attr-defined]  # noqa: S606
        return
    comando = "open" if sys.platform == "darwin" else "xdg-open"
    subprocess.Popen(  # noqa: S603
        [comando, str(caminho)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True,
    )


def abrir(anexo_id: int, db: sqlite3.Connection = Depends(get_db, scope="function")) -> Response:
    """App desktop: abre o anexo no visualizador do sistema (só tipos aceitos, só em uploads/)."""
    row = db.execute("SELECT caminho_arquivo FROM anexos WHERE id = ?", (anexo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Anexo não encontrado")
    caminho = _caminho_confinado(row["caminho_arquivo"])
    if caminho.suffix not in EXTENSAO_PARA_CONTENT_TYPE:
        raise HTTPException(400, "Tipo de anexo não permitido")
    if not caminho.is_file():
        raise HTTPException(404, "Arquivo não encontrado no disco")
    _abrir_no_sistema(caminho)
    return Response(status_code=204)


# Só existe no app desktop: no servidor, "abrir no sistema" abriria na máquina da VPS.
if MODO_DESKTOP:
    router.add_api_route("/{anexo_id}/abrir", abrir, methods=["POST"], status_code=204, response_class=Response)
