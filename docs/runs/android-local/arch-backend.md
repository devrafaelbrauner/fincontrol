# Arquitetura backend — fincontrol-a0-android-sync
`b/`=backend/app `m/`=b/migrations `f/`=frontend. [obs]=medido nesta run (Mac, CPython 3.15.2, sem Android); [doc]=doc/índice.

## Decisões
**D1 Runtime (S0/S1).** Python **3.13** (Chaquopy 17.2: 16 KB pede 3.13+; AGP 8.13 e minSdk 24 ok [doc]). Índice Chaquopy [obs]: cryptography 42.0.8, argon2-cffi-bindings 21.2.0, cffi 1.17.1 (cp313 arm64/x86_64); pydantic-core: 0. Release só arm64-v8a.
- **pydantic-core: cibuildwheel** (rec. do Chaquopy p/ 3.13+ [doc]). Workflow manual `wheels-android.yml` (ubuntu, KVM): sdist `pydantic_core==2.50.2` com hash (o pydantic 2.14.2 o fixa [obs]) → `rustup target add aarch64-linux-android x86_64-linux-android` → `cibuildwheel --platform android` (`CIBW_ARCHS_ANDROID="arm64_v8a x86_64"`, `CIBW_BUILD=cp313-*`, teste = import no emulador) → Release `wheels-android-pydantic-core-2.50.2` e `f/android/app/wheels/`+`SHA256SUMS`. Gradle: `pip{options("--find-links","wheels"); install("-r","../../../backend/requirements-android.txt")}`.
- `requirements-android.txt` (lock): `cryptography==42.0.8`; uvicorn sem `[standard]` [obs: asyncio+h11]; sem webauthn (pede cryptography≥49 [obs]); sem pywebpush (`b/routers/push.py:75`). Sem webauthn, `import app.main` quebra (`b/main.py:23`) [obs] → import dentro do `if not MODO_DESKTOP` (`:287`) [obs: sobe].
- **Transporte: socket 127.0.0.1 + token** (com ArqFrontend). Qualquer app alcança a porta e a Origin `https://localhost` é de todo Capacitor (K5): protegem token 256 bits, JWT e Host. Ponte em processo: sem socket, mas anexos de 15 MB (`b/routers/anexos.py:15`) em base64 e zero reuso; plano B se o WebView barrar http://127.0.0.1.
- `b/desktop_guard.py`: +Origin `https://localhost` com `FINCONTROL_MODO=android` (`:23,38`), que liga `MODO_DESKTOP` (`b/auth.py:25`). Novo `b/android.py iniciar(dados,segredos)→(porta,token)`: funções de `b/desktop.py` (`:82,96,128`), bind 127.0.0.1:0, import, `uvicorn.Server.run(sockets=[sock])` em thread [obs: 0,39 s; 401/400/403; Origin Android=403]. `/abrir` (`anexos.py:139`) → `{caminho}` (FileProvider).
- Segredos: AES-GCM do AndroidKeyStore (sem auth do usuário) cifra SECRET/FERNET do 1º uso (`sidecar.rs:604-620`); env só no import.
- Morte do processo: backend morre junto; WAL + migration transacional (`b/db.py:21,47-90`). **Achado:** `get_db` faz commit depois de a resposta sair (`b/db.py:32-38`) [obs: FastAPI 0.162, send→commit]; morte após o 200 perde a escrita. Correção: `Depends(get_db, scope="function")` (S2a). `quick_check` no boot.

**D2 Modelo (S5).** `sync_linha(gid PK,tabela,id_local,excluido,ver,pais,seq)` e `sync_estado(dispositivo,contador,aplicando)`, por triggers nas 14 tabelas e no `config` (`modelo_preferido`, `perfil_*`). Domínio intacto: id INTEGER local; API e front iguais.
- gid aleatório (128 bits); derivado onde os 2 aparelhos geram a mesma linha: fixo = `gid(conta)/competência`, on-access (`b/util.py:122-131`, `m/001:46`); orçamento = `gid(categoria)/orc` (`m/009:5`).
- Tombstone: o DELETE físico fica (`b/routers/variaveis.py:213`); o trigger grava `excluido=1, id_local=NULL` [obs, protótipo no schema real: CASCADE dispara, id reusado ganha gid novo, lastrowid/`INSERT OR IGNORE`/upsert/`aplicando` ok → 0 router muda].
- Relógio: contador por aparelho; `ver=<disp>:<n>`; `seq` = cursor de saída. Sem HLC (não há LWW). `versao` (`m/013`, `m/018`) fica local; mudança remota faz +1.
- Ids antigos: a 019 dá gid a tudo, pais antes (VPS idem, no deploy); o import gera `dispositivo` novo; o 2º aparelho entra por snapshot após zerar as 14 tabelas (até as categorias da `m/004`). Chave natural repetida (`m/001:11`, `m/012:16`): fica o menor gid, o outro vira alias; dado diferente = conflito.

**D3 Motor (S6).** Lote `{v,grupo,época,origem,n,mudanças[{t,gid,op,ver,pais,dados}],anexos}` (FK=gid) → JSON+zlib+AEAD. Cripto [obs: 42.0.8]: K do grupo; por lote, HKDF(K,sal) e ChaCha20Poly1305 com AAD=cabeçalho; Ed25519 da origem; chaves sob Fernet (`b/cripto.py`). Pareamento (S9): código de 8 só p/ encontro; X25519 + commitment + SAS de 6 dígitos confirmado nos 2; K sob a chave do par; revogar = nova época de K.
- Aplicar (1 transação por lote, savepoint por mudança): `ver` igual → ignora; gid novo → insere; local∈pais → avança; conteúdo igual → converge; senão → `sync_conflito` com as 2 versões, local intacto. Exclusão×edição e pai com filho local são conflito. Resolver (`b/util.py:158` + `versao_local`) gera versão com pais=[as 2].
- Idempotência: `(origem,n)` na mesma transação; o cursor só anda após o ack. Sem transação aberta durante rede (a IA segura até 60 s×3, `b/openrouter.py:21-22`); BUSY → reagenda.
- Anexos: id=HMAC(K,sha256) (`b/routers/anexos.py:72`), partes de 1 MiB retomáveis; >5 MB só no Wi-Fi. Transporte: `publicar/listar/baixar`, nomes gravados 1×; `TransporteArquivo` nos testes. Locais: credenciais, chave IA, push, webauthn, caches, conversa.

**D4 Canal (Q1): mantenho A**: motor agnóstico e VPS já com Caddy/systemd (`deploy/`).
- **A hub**: `PUT/GET /v1/grupos/{g}/lotes/{origem}/{n}` grava 1× (409 se diferir); `blobs/{id}/{i}`; pareamento (TTL 10 min); ack; revogar. Ed25519 por pedido, convite, cota. GC: ≥90 d após o ack (teto 180 d). Ameaça: vê tamanho, hora e IP; pode reter (buraco em n denuncia), não lê nem forja. Custo: HA4 e ~50 MB.
- **B LAN**: mesmas rotas no PC, socket só de sync (API do app em 127.0.0.1, `b/desktop.py:35`). Ameaça: porta do PC na LAN. Custo: 0 infra; firewall, AP isolation, 2 apps abertos.
- **C Drive**: mesmo layout numa pasta do drive. Ameaça: provedor vê metadados; token OAuth no aparelho. Custo: OAuth+SDK nos 2 sistemas.

**D5 Migração (S4/S10).** Um formato só: zip (`manifest`, `fincontrol.db`, `uploads/`). O par da VPS (`deploy/backup.sh:41,53`, decifrado, K6) entra zipado em `<data>/importacoes/`. No staging:
1. recusa zip-slip e schema mais novo; `integrity_check` e `foreign_key_check`;
2. relatório: linhas, Σ de cada `*_cents` e sha256 de 100% dos anexos;
3. `migrate` e saneamento (sai refresh, push, webauthn, ics e chave IA; `refresh_version+1`);
4. relatório igual ao da origem. O dry-run para aqui.

Aplicar: cópia prévia (`b/desktop.py:96`) e `staging.backup(vivo)` numa transação [obs: interrompido = intacto]. Sem sessão, só com banco virgem (`b/auth.py:327`) e sem par. Desfazer = restaurar a cópia. S10: VPS só leitura → relatório igual nos 2 aparelhos → aceite; rollback: VPS volta a gravar.

**D6 Arquivos backend/fatia** (sem front/casca):
| S | Arquivos | n |
|---|---|---|
|0|req-android, main, android, teste, CI, wheels(3)|8|
|1|auth, desktop_guard, main, android, versao, anexos, 2 testes|8|
|2a|db + 17 com `Depends(get_db)` + teste + CHANGELOG|20|
|2·3|android+teste · teste IA sem rede|2·1|
|4|backup, db, main, desktop, routers/dados, 3 testes, README|9|
|5|m/019, sync/{__init__,modelo}, backup, teste, CHANGELOG|6|
|6|m/020, sync/{motor,cifra,transporte,anexos}, routers/sync, main, 4 testes|11|
|7·9|routers/sync+teste · sync/{pareamento,motor}, hub/app, teste|2·5|
|8A|hub/{__init__,app,armazem}, transporte_hub, deploy×5, 2 testes|12|
|10·11|main, backup, README, teste · ~16 remoções + iOS|4·>20|

## Premissas
pydantic-core 2.50.2/cp313; VPS na 019 antes do corte; 2 aparelhos; PC sem dados próprios.

## Conflitos
Faltam no `sprint.md`: S2a e S11a/b/c. `versao` não é relógio global (K4). S1/S4 com o front passam de 20: dividir.

## Questões abertas
O1 O PC tem dados próprios? (v1: substitui) · O2 Convite do hub no `.env`? · O3 Zip cifrado? · O4 cryptography 42.0.8: 11 alertas OSV, nenhum nas primitivas usadas; aceitar no pip-audit? · O5 `fastapi>=0.121`?

## Verificação
S0: import no arm64, 16 KB, APK, boot, `sys.platform`, SQLite+JSON, fetch a 127.0.0.1. S1: 401/400/403; `ss` só em 127.0.0.1; segredo fora dos logs. S2a: erro no commit = 500. S4: relatórios iguais; import interrompido = banco intacto. S5: 14×3 triggers, suíte verde. S6: 50 escritas por lado, checksum igual, 0 duplicata, 0 LWW, busca = 0, replay recusado. S8: assinatura e GC.
