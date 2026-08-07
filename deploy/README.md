# Deploy — FinControl (VPS + Caddy)

Arquitetura: **Caddy** (HTTPS automático) → **uvicorn** (systemd) → SQLite/uploads em disco.
Frontend é buildado para `frontend/dist/` e servido pelo Caddy (mesmo host → sem CORS).

Modelo de operação: **root orquestra** (systemctl/caddy/deploy.sh); o código pertence ao
usuário de sistema **`fincontrol`**, e todo git/pip/npm roda como ele (`sudo -u fincontrol`).

## Pré-requisitos

- VPS com Debian/Ubuntu, Python 3.11+, **Node ≥ 20.19 ou ≥ 22.12** (exigência do
  Vite 7 — o `Node 20+` genérico não basta: 20.0–20.18 quebram o build), `git`,
  `sqlite3` (CLI, para backup),
  e **Caddy** instalado (https://caddyserver.com/docs/install).
- `rclone` se quiser backup offsite (recomendado): `apt install rclone` + `rclone config`.
- Um subdomínio (ex. `fincontrol.seudominio.com`) com **registro A** apontando para o IP da VPS.
- **Firewall**: `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`.
- **Swap** (VPS pequena): o build do Vite/tsc pode estourar a RAM de uma CX22 sem swap —
  `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
  (persistir em `/etc/fstab`). Alternativa: buildar o `dist/` fora e enviar por rsync.

## Provisionamento inicial (uma vez, como root)

```bash
# 1. Usuário de serviço (sem home automático — o clone cria o diretório)
useradd --system --shell /usr/sbin/nologin --home-dir /opt/fincontrol -M fincontrol

# 2. Deploy key (o repositório é PRIVADO — https sem credencial falha)
install -d -o fincontrol -g fincontrol -m 700 /opt/fincontrol-ssh
sudo -u fincontrol ssh-keygen -t ed25519 -N "" -f /opt/fincontrol-ssh/id_ed25519
cat /opt/fincontrol-ssh/id_ed25519.pub
#   → cole em GitHub > repo > Settings > Deploy keys (somente leitura)

# 3. Clone como fincontrol (diretório destino não pode existir antes)
sudo -u fincontrol GIT_SSH_COMMAND="ssh -i /opt/fincontrol-ssh/id_ed25519 -o StrictHostKeyChecking=accept-new" \
  git clone git@github.com:rafaelbrauner22-bit/fincontrol.git /opt/fincontrol
# Persiste a chave para os git pull futuros:
sudo -u fincontrol git -C /opt/fincontrol config core.sshCommand \
  "ssh -i /opt/fincontrol-ssh/id_ed25519 -o StrictHostKeyChecking=accept-new"
# O Caddy (usuário caddy) precisa LER o dist — sem isto: 403 em tudo.
chmod 755 /opt/fincontrol

# 4. Ambiente do backend
cd /opt/fincontrol/backend
# Diretório de dados (SQLite + uploads) — precisa existir ANTES do serviço subir,
# porque o systemd monta ReadWritePaths sobre ele (ProtectSystem=strict).
sudo -u fincontrol mkdir -p /opt/fincontrol/backend/data/uploads
chmod 750 /opt/fincontrol/backend/data
sudo -u fincontrol cp ../deploy/.env.example .env
chmod 600 .env                            # contém SECRET_KEY e FERNET_KEY
# Gere segredos fortes prontos para colar (SECRET_KEY + FERNET_KEY):
/opt/fincontrol/deploy/preflight.sh gen
nano .env    # FINCONTROL_ENV=production, SECRET_KEY, FERNET_KEY, COOKIE_SECURE=1
sudo -u fincontrol python3 -m venv .venv
sudo -u fincontrol .venv/bin/pip install -r requirements.txt
# Valide o .env antes de prosseguir (produção recusa subir com defaults):
/opt/fincontrol/deploy/preflight.sh check

# 5. Senha (e 2FA) do usuário único — CARREGUE o .env antes: sem ele o setup
# gravaria num banco diferente do que o serviço usa (FINCONTROL_DATA).
#
# ESTE PASSO VEM ANTES DO 6 E DO 7, e a ordem é de segurança, não de estilo:
# com o banco sem conta, /api/auth/cadastro fica aberto e o primeiro que
# alcançar o domínio vira o dono da instância. Com a conta criada, o cadastro
# responde 409 para sempre. Mesmo cuidado ao restaurar backup ou trocar
# FINCONTROL_DATA: banco vazio no ar = cadastro aberto. Confira com
#   curl -s https://SEU-DOMINIO/api/auth/status   → {"configurado":true}
sudo -u fincontrol bash -c 'set -a; . ./.env; set +a; .venv/bin/python -m app.setup_user'

# 6. Serviço systemd
cp /opt/fincontrol/deploy/fincontrol.service /etc/systemd/system/
# ATENÇÃO: se mudar FINCONTROL_DATA no .env, ajuste ReadWritePaths na unit.
systemctl daemon-reload
systemctl enable --now fincontrol

# 7. Caddy — domínio e caminho do build via ambiente do serviço
mkdir -p /etc/systemd/system/caddy.service.d
tee /etc/systemd/system/caddy.service.d/fincontrol.conf >/dev/null <<'EOF'
[Service]
Environment=FINCONTROL_DOMAIN=fincontrol.seudominio.com
Environment=FINCONTROL_FRONTEND_DIST=/opt/fincontrol/frontend/dist
EOF
cp /opt/fincontrol/deploy/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile     # domínio vazio derruba o Caddy inteiro
systemctl daemon-reload && systemctl restart caddy

# 8. Primeiro build do frontend
cd /opt/fincontrol/frontend
sudo -u fincontrol -H npm ci --include=dev && sudo -u fincontrol -H npm run build

# 9. Backup diário (obrigatório antes de usar de verdade)
cp /opt/fincontrol/deploy/fincontrol-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now fincontrol-backup.timer
# Offsite: configure o rclone (rclone config) e defina no backend/.env:
#   FINCONTROL_BACKUP_REMOTE=b2:seu-bucket/fincontrol
/opt/fincontrol/deploy/backup.sh          # primeiro backup manual, valida o fluxo
```

Acesse `https://fincontrol.seudominio.com` — o Caddy emite o certificado automaticamente.

## Atualizações (um comando, como root)

```bash
cd /opt/fincontrol && ./deploy/deploy.sh
```

Valida o `.env`, faz `git pull` (como `fincontrol`), atualiza dependências, builda o
frontend, faz **backup do banco**, reinicia o backend (migrations rodam no startup),
valida e recarrega o Caddy e testa o `/api/health`.

## Backup e restauração

- **Diário automático**: `fincontrol-backup.timer` (03h30) → `deploy/backup.sh`:
  `sqlite3 .backup` com timestamp + `integrity_check` + `uploads.tar.gz`, retenção
  local de 14 dias em `/var/backups/fincontrol`, e `rclone copy` para o offsite se
  `FINCONTROL_BACKUP_REMOTE` estiver no `.env`.
- **Restauração** (testar 1x/trimestre): `systemctl stop fincontrol`, copiar o
  `fincontrol.db` do backup para `$FINCONTROL_DATA`, extrair `uploads.tar.gz` no
  mesmo lugar, `systemctl start fincontrol`.

## Ícones e splash (regenerar sob demanda)

Os PNGs gerados estão versionados. Para regenerar a partir de `frontend/assets/`
(logo.svg/splash.png), rode sob demanda — o pacote não fica em devDependencies
porque a cadeia dele (tar/sharp antigos) concentrava as vulnerabilidades do npm audit:

```bash
cd frontend && npx @capacitor/assets generate --ios --android --pwa
```

## Apps Capacitor apontando para a VPS

A URL da API entra **em build time** e fica congelada no bundle: um deploy
atualiza o web, e **não** atualiza os celulares. Rebuildar é parte de trocar de
domínio.

```bash
cd frontend && VITE_API_BASE=https://fincontrol.seudominio.com npm run ios
cd frontend && VITE_API_BASE=https://fincontrol.seudominio.com npm run android
```

Os dois scripts recusam uma base que não sirva num aparelho de verdade —
ausente, vazia, `http://` ou apontando para `localhost`/`127.0.0.1`. Foi assim
que um bundle saiu apontando para `http://127.0.0.1:8001`, que num iPhone é o
loopback do próprio telefone: nada funcionava, e nada avisava. Para o teste em
rede local (abaixo), `FINCONTROL_BUILD_LOCAL=1` libera a checagem.

**CORS não precisa de configuração**: `capacitor://localhost` (iOS) e
`https://localhost` (Android) são sempre aceitas pelo backend. Não confunda as
duas — cada plataforma tem a sua, e são os defaults do Capacitor 8 (nenhum
`iosScheme`/`androidScheme` no `capacitor.config.ts`).

Depois do build, o APK de release sai com:

```bash
cd frontend/android && ./gradlew assembleRelease
```

**Teste na rede local, contra o backend em HTTP**, precisa de duas permissões que
o build de produção não tem — e nenhuma delas é ligada por padrão:

```bash
cd frontend && npm run apk:teste
```

O script descobre o IP desta máquina, monta o bundle com ele, compila o APK
debug (a variante que libera tráfego em texto claro) e imprime o comando do
backend. Fazer isso à mão tem duas armadilhas silenciosas, e as duas já
custaram um APK que não funcionava:

1. **O IP fica congelado no bundle.** Trocar de rede — ou o DHCP renovar —
   invalida o APK sem nada avisar: o app só fica girando.
2. **O backend padrão sobe em `--host 127.0.0.1`**, que aceita conexão só da
   própria máquina. Mesmo com o IP certo no APK, o celular não alcança.

Por isso o script termina imprimindo o comando do backend, já com o bind certo,
a porta certa e as chaves preenchidas — **use o que ele imprime**, e não uma
cópia daqui, que envelhece. O porquê de cada chave sai junto no mesmo texto; em
resumo, o `FINCONTROL_SECRET_KEY` é sorteado porque o default do repositório é
público e em `0.0.0.0` qualquer um na rede forjaria um JWT, e o
`FINCONTROL_FERNET_KEY` vai fixo junto porque, sem ele, o sorteio tornaria
ilegível a chave do OpenRouter guardada no banco.

Se você usar outra porta, passe a MESMA nos dois lados:
`FINCONTROL_PORTA=8010 npm run apk:teste`. Divergir aqui produz o mesmo "app só
fica girando", agora por porta e não por IP.

Isso expõe o backend de desenvolvimento à rede local — use só na sua rede,
encerre quando terminar, e não deixe rodando assim.

O `usesCleartextTraffic` vive em `app/src/debug/AndroidManifest.xml`, sobrepondo o
`false` do manifesto principal só na variante debug; e o `allowMixedContent` depende
da variável acima. Assim o release sai seguro por construção, em vez de depender de
alguém lembrar de desfazer a permissão antes de distribuir. Confira no APK gerado:

```bash
# deve responder "false" para o release
aapt dump xmltree app/build/outputs/apk/release/app-release.apk AndroidManifest.xml \
  | grep -i cleartext
```

## Notas

- **Push (opcional):** gere as chaves com
  `sudo -u fincontrol bash -c 'set -a; . ./.env; set +a; .venv/bin/python -m app.gerar_vapid'`,
  cole as `FINCONTROL_VAPID_*` no `.env` **com um `FINCONTROL_VAPID_SUBJECT=mailto:` real**
  (o Apple Web Push rejeita subject inválido) e `systemctl restart fincontrol`.
  Sem elas, o push fica desabilitado e o calendário assinado segue como lembrete principal.
- **Lembretes automáticos:** com as chaves VAPID no `.env`, o backend sobe um agendador
  interno que roda todo dia às 8h (`FINCONTROL_LEMBRETE_HORA`) e no start — avisa sobre
  contas a vencer, vencendo hoje e em atraso, e no dia 1 manda o resumo do mês fechado
  com insights de IA. Não precisa de cron nem timer: é uma tarefa asyncio no próprio
  processo (o `ExecStart` roda um worker só — se um dia virar `--workers N`, cada worker
  ligaria o seu, e aí o job precisa sair para um systemd timer chamando
  `POST /api/push/lembretes`). Para conferir sem esperar: **Configurações** →
  "Ver lembretes de hoje" / "Enviar agora".
- **Feed `.ics`:** é público por design (token secreto na URL) — o Caddy encaminha
  `/calendar/*` ao backend. Trate a URL como senha; regenere pelo app se vazar.
- **Cookie de refresh:** exige HTTPS (`FINCONTROL_COOKIE_SECURE=1`) — por isso o Caddy
  na frente é obrigatório em produção.
- **ACME/Let's Encrypt:** adicione `email seu@email` num bloco global do Caddyfile para
  receber avisos de renovação de certificado.
