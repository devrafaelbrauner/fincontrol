import json
import os
import re
import secrets
import sqlite3
import time

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from .db import get_db

# Ambiente: "dev" (padrão, permite rodar sem configuração) ou "production".
# Em produção, main.py exige segredos próprios e recusa subir com os defaults.
ENV = os.environ.get("FINCONTROL_ENV", "dev").strip().lower()
IS_PROD = ENV in ("production", "prod")

SECRET_KEY_DEFAULT = "dev-insecure-troque-em-producao"
SECRET_KEY = os.environ.get("FINCONTROL_SECRET_KEY", SECRET_KEY_DEFAULT)
ACCESS_TTL_SEGUNDOS = 30 * 60           # JWT de acesso, curto
REFRESH_TTL_SEGUNDOS = 30 * 24 * 60 * 60  # refresh token, longo (cookie httpOnly)
COOKIE_NOME = "fincontrol_refresh"
COOKIE_PATH = "/api/auth"
# Em produção (HTTPS) o cookie deve ser Secure; em dev via http, não.
# Secure por padrão quando FINCONTROL_ENV=production; opt-out explícito só em dev.
COOKIE_SECURE = os.environ.get("FINCONTROL_COOKIE_SECURE", "1" if IS_PROD else "0") == "1"

ph = PasswordHasher()
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    senha: str
    email: str | None = None
    codigo_totp: str | None = None
    lembrar: bool = True  # False → cookie de sessão (morre ao fechar o navegador)


class CadastroBody(BaseModel):
    nome: str
    telefone: str | None = None
    email: str
    senha: str


class CodigoBody(BaseModel):
    codigo: str


# Mínimo de 12 por decisão de segurança (era 6 — fraco contra db vazado).
#
# O rate limit do login não alcança um atacante com o arquivo do banco na mão,
# e o TOTP é opcional nos dois caminhos de criação de conta, então a senha é a
# última barreira contra `fincontrol.db` vazado — copiado para fora da VPS todo
# dia pelo backup. 12 caracteres com variedade é o piso aceitável.
#
# Espelhado em frontend/src/pages/Login.tsx (REGRAS) — mexeu aqui, mexa lá.
SENHA_MINIMA = 12


def _validar_senha(senha: str) -> str | None:
    """Política: mínimo de 12 caracteres, com letra, número e caractere especial."""
    if len(senha) < SENHA_MINIMA:
        return f"A senha precisa de pelo menos {SENHA_MINIMA} caracteres"
    if not re.search(r"[A-Za-z]", senha):
        return "A senha precisa de pelo menos uma letra"
    if not re.search(r"\d", senha):
        return "A senha precisa de pelo menos um número"
    if not re.search(r"[^A-Za-z0-9]", senha):
        return "A senha precisa de pelo menos um caractere especial (!@#$%…)"
    return None


def config_get(db: sqlite3.Connection, chave: str) -> str | None:
    row = db.execute("SELECT valor FROM config WHERE chave = ?", (chave,)).fetchone()
    return row["valor"] if row else None


def _refresh_version(db: sqlite3.Connection) -> int:
    return int(config_get(db, "refresh_version") or "0")


def _config_set(db: sqlite3.Connection, chave: str, valor: str) -> None:
    db.execute(
        "INSERT INTO config (chave, valor) VALUES (?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (chave, valor),
    )


def _bump_refresh_version(db: sqlite3.Connection) -> None:
    _config_set(db, "refresh_version", str(_refresh_version(db) + 1))
    db.execute("DELETE FROM refresh_tokens")


# Teto de sessões simultâneas (web + iPhone + macOS sobram folgados em 10).
MAX_SESSOES = 10

# Quanto tempo um jti recém-rotacionado ainda é aceito, devolvendo o sucessor em
# vez de acusar vazamento.
#
# Existe por causa de uma corrida rotineira, não teórica: `renovar()` no frontend
# não era single-flight, então uma tela com `Promise.all` disparava N chamadas
# que voltavam 401 juntas e viravam N `/refresh` com o MESMO token. A primeira
# rotacionava; as demais chegavam com o token já gasto e derrubavam TODOS os
# aparelhos. Reproduzido com 6 chamadas: 3 sessões viravam 0.
#
# Curta de propósito. Alargá-la para cobrir "resposta perdida e retomada horas
# depois" abriria a janela em que um token vazado ainda funciona — e é justamente
# a detecção de reuso que paga por isso. Fora da janela, revogar tudo continua
# sendo a resposta certa.
JANELA_GRACA_SEGUNDOS = 30


# Refresh tokens, uma linha por sessão (tabela refresh_tokens). A rotação MARCA o
# jti antigo (sucessor_jti + rotacionado_em) em vez de apagá-lo; um jti ausente
# segue denunciando reuso (vazamento).
def _registrar_jti(db: sqlite3.Connection, jti: str, exp: int, remover: str | None = None) -> bool:
    """Grava o jti novo. Com `remover`, rotaciona o antigo.

    Devolve False quando a rotação perdeu a corrida — outra requisição já
    rotacionou este mesmo token — e nada é gravado. É um compare-and-swap:
    `rotacionado_em IS NULL` na cláusula garante que só a primeira das N chamadas
    simultâneas emite um token novo. Sem isso, as N rotacionavam em paralelo (cada
    uma lê "vigente" antes de qualquer escrita) e sobravam N−1 sessões órfãs, que
    empurram os aparelhos ociosos contra o teto de MAX_SESSOES.
    """
    agora = int(time.time())
    if remover:
        # Rotação: o antigo aponta para o sucessor pela duração da janela de graça.
        cur = db.execute(
            "UPDATE refresh_tokens SET sucessor_jti = ?, rotacionado_em = ? "
            "WHERE jti = ? AND rotacionado_em IS NULL",
            (jti, agora, remover),
        )
        if cur.rowcount == 0:
            return False
    db.execute("DELETE FROM refresh_tokens WHERE expira_em <= ?", (agora,))
    # Vencida a graça, a linha some e o jti volta a ser "desconhecido" — é o que
    # mantém a detecção de vazamento de pé e a tabela do tamanho das sessões reais.
    db.execute(
        "DELETE FROM refresh_tokens WHERE rotacionado_em IS NOT NULL AND rotacionado_em <= ?",
        (agora - JANELA_GRACA_SEGUNDOS,),
    )
    db.execute("INSERT INTO refresh_tokens (jti, expira_em) VALUES (?, ?)", (jti, exp))
    # Passou do teto: encerra as sessões mais antigas marcando vigente = 0.
    # Despejo NÃO é reuso — marcar (em vez de apagar) é o que evita que o dono,
    # ao voltar na sessão despejada, derrube todas as outras junto.
    # `rotacionado_em IS NULL` exclui as linhas em graça: elas não são sessões
    # vivas, e contá-las despejaria sessões de verdade a cada renovação.
    db.execute(
        """UPDATE refresh_tokens SET vigente = 0 WHERE jti IN (
             SELECT jti FROM refresh_tokens WHERE vigente = 1 AND rotacionado_em IS NULL
             ORDER BY expira_em DESC, rowid DESC LIMIT -1 OFFSET ?)""",
        (MAX_SESSOES,),
    )
    return True


def _estado_jti(db: sqlite3.Connection, jti: str) -> str:
    """'vigente', 'rotacionado' (dentro da graça), 'despejado' (teto) ou
    'desconhecido' (reuso/forjado)."""
    agora = int(time.time())
    row = db.execute(
        "SELECT vigente, rotacionado_em FROM refresh_tokens WHERE jti = ? AND expira_em > ?",
        (jti, agora),
    ).fetchone()
    if row is None:
        return "desconhecido"
    if row["rotacionado_em"] is not None:
        # A purga acontece na emissão; até lá, a janela é conferida aqui.
        dentro = agora - row["rotacionado_em"] <= JANELA_GRACA_SEGUNDOS
        return "rotacionado" if dentro else "desconhecido"
    return "vigente" if row["vigente"] else "despejado"


def _token_do_jti(db: sqlite3.Connection, jti: str) -> str | None:
    """Re-assina o refresh token de um jti já emitido.

    O token é um JWT determinístico (mesmo payload, mesma assinatura), então dá
    para devolvê-lo de novo sem guardar o bearer token no banco — o que seria
    guardar credencial em repouso à toa.
    """
    row = db.execute("SELECT expira_em FROM refresh_tokens WHERE jti = ?", (jti,)).fetchone()
    if row is None:
        return None
    return jwt.encode(
        {"sub": "dono", "type": "refresh", "ver": _refresh_version(db), "jti": jti, "exp": row["expira_em"]},
        SECRET_KEY,
        algorithm="HS256",
    )


def _sucessor_vigente(db: sqlite3.Connection, jti: str) -> str | None:
    """Segue a cadeia de sucessores até o token que está valendo agora.

    Mais de um salto acontece quando várias chamadas em graça chegam depois de o
    cliente já ter rotacionado de novo. Sem seguir a cadeia, devolveríamos um
    token intermediário — que funciona, mas obriga o cliente a mais uma rodada.
    """
    for _ in range(MAX_SESSOES):  # teto contra cadeia circular por dado corrompido
        row = db.execute("SELECT sucessor_jti FROM refresh_tokens WHERE jti = ?", (jti,)).fetchone()
        if row is None:
            return None
        if row["sucessor_jti"] is None:
            return jti
        jti = row["sucessor_jti"]
    return None


def _emitir_access() -> str:
    return jwt.encode(
        {"sub": "dono", "type": "access", "exp": int(time.time()) + ACCESS_TTL_SEGUNDOS},
        SECRET_KEY,
        algorithm="HS256",
    )


def _emitir_refresh(db: sqlite3.Connection, substituir_jti: str | None = None) -> str | None:
    """Emite um refresh token. None quando a rotação perdeu a corrida (ver
    `_registrar_jti`) — aí quem chama devolve o sucessor já emitido."""
    jti = secrets.token_hex(16)
    exp = int(time.time()) + REFRESH_TTL_SEGUNDOS
    if not _registrar_jti(db, jti, exp, remover=substituir_jti):
        return None
    return jwt.encode(
        {"sub": "dono", "type": "refresh", "ver": _refresh_version(db), "jti": jti, "exp": exp},
        SECRET_KEY,
        algorithm="HS256",
    )


def _set_cookie(resp: Response, token: str, persistente: bool = True) -> None:
    resp.set_cookie(
        COOKIE_NOME, token,
        max_age=REFRESH_TTL_SEGUNDOS if persistente else None,  # None = cookie de sessão
        httponly=True, secure=COOKIE_SECURE,
        samesite="lax", path=COOKIE_PATH,
    )


# Cobre a valid_window=1 do TOTP (passo de 30s: anterior + atual + seguinte).
JANELA_TOTP_SEGUNDOS = 95


def _totp_ja_usado(db: sqlite3.Connection, codigo: str) -> bool:
    """Anti-replay: um código TOTP interceptado não vale duas vezes na janela.

    Guarda TODOS os códigos recentes, não só o último — com um só, bastava um
    login intercalado com o código seguinte para liberar a repetição do anterior.
    """
    agora = int(time.time())
    try:
        recentes = json.loads(config_get(db, "totp_usados") or "{}")
    except json.JSONDecodeError:
        recentes = {}
    if not isinstance(recentes, dict):
        recentes = {}
    vivos = {
        c: t for c, t in recentes.items()
        if isinstance(t, int) and 0 <= agora - t < JANELA_TOTP_SEGUNDOS
    }
    repetido = codigo in vivos
    vivos[codigo] = agora
    _config_set(db, "totp_usados", json.dumps(vivos))
    return repetido


def _cliente_nativo(request: Request) -> bool:
    """App Capacitor (iOS/macOS/Android). Como o WebView roda cross-origin, o
    cookie de refresh não trafega: o app recebe o refresh token no corpo e o
    reenvia no header X-Refresh-Token. O web (same-origin) nunca manda X-Client."""
    return request.headers.get("X-Client") == "native"


@router.get("/status")
def status(db: sqlite3.Connection = Depends(get_db)):
    """Público: o frontend decide entre tela de login e de cadastro (primeiro uso)."""
    return {"configurado": config_get(db, "senha_hash") is not None}


@router.post("/cadastro", status_code=201)
@limiter.limit("5/minute")
def cadastro(request: Request, response: Response, body: CadastroBody, db: sqlite3.Connection = Depends(get_db)):
    """Cria a conta única no primeiro uso. Com conta existente, retorna 409 —
    nunca sobrescreve (redefinição de senha é pelo terminal: python -m app.setup_user).

    Em produção a rota é bloqueada (403): a conta deve ser criada via SSH
    (`python -m app.setup_user`). Banco vazio no ar = janela first-claimer para
    quem alcançar o domínio primeiro — ver deploy/README.md passo 5."""
    if IS_PROD:
        raise HTTPException(403, "Cadastro via web desabilitado em produção — use: python -m app.setup_user")
    if config_get(db, "senha_hash"):
        raise HTTPException(409, "Conta já configurada — use a tela de login")
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(422, "Informe seu nome")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", body.email.strip()):
        raise HTTPException(422, "E-mail inválido")
    if erro := _validar_senha(body.senha):
        raise HTTPException(422, erro)
    # DO NOTHING em vez de _config_set: a checagem lá em cima é só para o erro
    # bonito — entre ela e aqui cabe um segundo cadastro, e quem chegar depois
    # sobrescreveria a senha do dono. A gravação condicional decide no banco.
    cur = db.execute(
        "INSERT INTO config (chave, valor) VALUES ('senha_hash', ?) ON CONFLICT(chave) DO NOTHING",
        (ph.hash(body.senha),),
    )
    if cur.rowcount == 0:
        raise HTTPException(409, "Conta já configurada — use a tela de login")
    _config_set(db, "perfil_nome", nome)
    _config_set(db, "perfil_email", body.email.strip())
    if body.telefone and body.telefone.strip():
        _config_set(db, "perfil_telefone", body.telefone.strip())
    # Auto-login: emite a mesma sessão que o /login emitiria.
    refresh_token = _emitir_refresh(db)
    _set_cookie(response, refresh_token)
    resposta = {"token": _emitir_access(), "nome": nome}
    if _cliente_nativo(request):
        resposta["refresh_token"] = refresh_token
    return resposta


@router.post("/login")
@limiter.limit("5/minute")                                    # por IP
@limiter.limit("30/minute", key_func=lambda *_: "login")      # teto global: Argon2 custa 64 MiB/tentativa
def login(request: Request, response: Response, body: LoginBody, db: sqlite3.Connection = Depends(get_db)):
    senha_hash = config_get(db, "senha_hash")
    if not senha_hash:
        raise HTTPException(503, "Usuário não configurado — rode: python -m app.setup_user")
    try:
        ph.verify(senha_hash, body.senha)
    except VerificationError:  # inclui mismatch e hash corrompido/inválido no banco
        raise HTTPException(401, "E-mail ou senha incorretos")
    # E-mail confere com o do perfil (contas antigas, sem perfil_email, pulam a checagem).
    email_perfil = config_get(db, "perfil_email")
    if email_perfil and (body.email or "").strip().lower() != email_perfil.lower():
        raise HTTPException(401, "E-mail ou senha incorretos")
    totp_secret = config_get(db, "totp_secret")
    if totp_secret:
        if not body.codigo_totp:
            # Senha ok, falta o segundo fator: o frontend troca para a tela do código.
            raise HTTPException(401, "codigo_totp_necessario")
        if not pyotp.TOTP(totp_secret).verify(body.codigo_totp, valid_window=1):
            raise HTTPException(401, "Código incorreto — confira o app autenticador")
        if _totp_ja_usado(db, body.codigo_totp):
            raise HTTPException(401, "Código incorreto — confira o app autenticador")
    refresh_token = _emitir_refresh(db)
    _set_cookie(response, refresh_token, persistente=body.lembrar)
    resposta = {"token": _emitir_access(), "nome": config_get(db, "perfil_nome")}
    if _cliente_nativo(request):
        resposta["refresh_token"] = refresh_token
    return resposta


@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db),
            x_refresh_token: str | None = Header(default=None)):
    # Web: refresh token no cookie httpOnly. Nativo: no header X-Refresh-Token.
    cookie = request.cookies.get(COOKIE_NOME) or x_refresh_token
    if not cookie:
        raise HTTPException(401, "Sem refresh token")
    try:
        dados = jwt.decode(cookie, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Refresh token inválido ou expirado")
    if dados.get("type") != "refresh" or dados.get("ver") != _refresh_version(db):
        raise HTTPException(401, "Refresh token revogado")
    jti = dados.get("jti")

    def _responder(token_refresh: str):
        _set_cookie(response, token_refresh)
        corpo = {"token": _emitir_access()}
        if _cliente_nativo(request):
            corpo["refresh_token"] = token_refresh
        return corpo

    def _token_em_graca() -> str | None:
        """O token que já foi emitido para esta sessão, se ela ainda vale.

        O sucessor pode ter sido encerrado durante a janela (logout deste
        aparelho, despejo pelo teto): devolvê-lo reabriria uma sessão que o dono
        acabou de fechar, então aí a graça não vale.
        """
        sucessor = _sucessor_vigente(db, jti)
        if sucessor and _estado_jti(db, sucessor) == "vigente":
            return _token_do_jti(db, sucessor)
        return None

    estado = _estado_jti(db, jti) if jti else "desconhecido"
    if estado == "rotacionado":
        # Rotacionado agora há pouco: quase sempre é a segunda de N chamadas
        # simultâneas da mesma tela, não vazamento. Devolve o sucessor que já foi
        # emitido — resposta idempotente, sem rotacionar de novo.
        atual = _token_em_graca()
        if atual is not None:
            return _responder(atual)
        estado = "despejado"  # sessão encerrada, não vazamento
    if estado == "despejado":
        # Sessão encerrada — pelo teto de sessões simultâneas ou por logout deste
        # aparelho. Só este cliente precisa entrar de novo; as demais continuam
        # de pé, porque isto não é indício de vazamento.
        #
        # A linha NÃO é apagada de propósito: apagá-la faria a próxima tentativa
        # com o mesmo token cair em "desconhecido" — e aí sim revogaria tudo. Um
        # aparelho que insiste (aba velha, app retomando) derrubaria os outros.
        # A limpeza vem da expiração natural, em _registrar_jti.
        raise HTTPException(401, "Sessão encerrada — entre novamente")
    if estado == "desconhecido":
        # Token assinado e não expirado, mas já rotacionado FORA da janela de
        # graça (ou nunca emitido): reuso = provável vazamento. Revoga a família
        # inteira e força novo login.
        _bump_refresh_version(db)
        db.commit()  # o get_db não faz commit quando a resposta é uma exceção
        raise HTTPException(401, "Refresh token revogado")
    novo = _emitir_refresh(db, substituir_jti=jti)  # rotação: o antigo entra em graça
    if novo is None:
        # Perdemos a corrida no compare-and-swap: outra requisição rotacionou este
        # mesmo token entre a leitura do estado e a escrita. Concorrência de
        # verdade cai aqui (o caminho "rotacionado" acima só pega quem chegou
        # depois da escrita), e a resposta é a mesma: o sucessor já emitido.
        db.commit()  # encerra o snapshot para enxergar o que a vencedora gravou
        atual = _token_em_graca()
        if atual is None:
            raise HTTPException(401, "Sessão encerrada — entre novamente")
        return _responder(atual)
    return _responder(novo)


@router.post("/logout")
@limiter.limit("10/minute")
def logout(request: Request, response: Response, todos: bool = False,
           db: sqlite3.Connection = Depends(get_db),
           x_refresh_token: str | None = Header(default=None)):
    """Encerra a sessão DESTE aparelho. `?todos=1` derruba todos os outros também.

    Antes era sempre global: sair no navegador do trabalho derrubava o iPhone no
    meio do uso. Com vários aparelhos no mesmo login, o padrão certo é o oposto —
    "sair daqui" é o gesto comum, e revogar tudo é a exceção (aparelho perdido),
    que agora é explícita.
    """
    # Só quem apresenta um refresh token válido pode revogar as sessões — sem
    # isso a rota seria um DoS não autenticado (derrubar todas as sessões em loop).
    token = request.cookies.get(COOKIE_NOME) or x_refresh_token
    if token:
        try:
            dados = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            if dados.get("type") == "refresh" and dados.get("ver") == _refresh_version(db):
                if todos:
                    _bump_refresh_version(db)  # invalida todos os refresh tokens existentes
                elif dados.get("jti"):
                    # Só esta sessão, marcada como encerrada (mesmo estado do
                    # despejo por lotação). Marcar em vez de apagar é o que evita
                    # que uma tentativa posterior com este token caia em
                    # "desconhecido" e derrube todos os aparelhos. O antecessor
                    # ainda em graça também não reabre a sessão: o /refresh só
                    # devolve o sucessor se ele estiver vigente.
                    db.execute("UPDATE refresh_tokens SET vigente = 0 WHERE jti = ?", (dados["jti"],))
        except jwt.PyJWTError:
            pass  # anônimo/expirado: só limpa o cookie, sem tocar nas sessões
    response.delete_cookie(COOKIE_NOME, path=COOKIE_PATH)
    return {"ok": True}


def require_auth(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Não autenticado")
    try:
        dados = jwt.decode(authorization[7:], SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sessão inválida ou expirada")
    if dados.get("type") != "access":
        raise HTTPException(401, "Token inválido para esta operação")


# ---------- MFA (TOTP) — ativação em duas etapas, com o usuário logado ----------

@router.get("/mfa", dependencies=[Depends(require_auth)])
def mfa_status(db: sqlite3.Connection = Depends(get_db)):
    return {"ativo": config_get(db, "totp_secret") is not None}


@router.post("/mfa/iniciar", dependencies=[Depends(require_auth)])
def mfa_iniciar(db: sqlite3.Connection = Depends(get_db)):
    """Gera um secret PENDENTE (só vira exigência de login após confirmar um código
    — garante que o autenticador foi cadastrado antes de trancar a porta)."""
    secret = pyotp.random_base32()
    _config_set(db, "totp_secret_pendente", secret)
    email = config_get(db, "perfil_email") or "dono"
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name="FinControl")
    return {"secret": secret, "otpauth_uri": uri}


@router.post("/mfa/confirmar", dependencies=[Depends(require_auth)])
def mfa_confirmar(body: CodigoBody, db: sqlite3.Connection = Depends(get_db)):
    secret = config_get(db, "totp_secret_pendente")
    if not secret:
        raise HTTPException(400, "Nenhuma ativação de MFA em andamento")
    if not pyotp.TOTP(secret).verify(body.codigo.strip(), valid_window=1):
        raise HTTPException(400, "Código incorreto — confira o app autenticador")
    _config_set(db, "totp_secret", secret)
    db.execute("DELETE FROM config WHERE chave = 'totp_secret_pendente'")
    return {"ativo": True}


@router.post("/mfa/desativar", dependencies=[Depends(require_auth)])
def mfa_desativar(body: CodigoBody, db: sqlite3.Connection = Depends(get_db)):
    secret = config_get(db, "totp_secret")
    if not secret:
        return {"ativo": False}
    if not pyotp.TOTP(secret).verify(body.codigo.strip(), valid_window=1):
        raise HTTPException(400, "Código incorreto")
    db.execute("DELETE FROM config WHERE chave = 'totp_secret'")
    return {"ativo": False}


