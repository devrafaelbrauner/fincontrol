# UX — fluxos e matriz rota × estado
`f/`=frontend/src. Vp: **C** celular retrato 360–412 · **D** 1280 · **M** 900; sem Vp = C D M.

## Decisões
- U1 Android usa o boot local do desktop (`f/main.tsx:96-177`): TelaBackend → sessão → Bloqueio → App.
- U2 Telas novas inevitáveis: **PrimeiroUso**, **AssistenteImport**, **Parear** (moldura `auth-split`/`auth-form`, como `f/components/TelaServidor.tsx:31-33`) e rota **/conflitos** (`f/App.tsx:43-56,161-175`). Nenhuma atual tem passos nem 2 versões.
- U3 **IndicadorSync** (`btn-icone` no `topo`, `GET /api/sync/estado`) só com par (A7.2); erro/conflito em `offline-barra` (`f/components/OfflineBar.tsx:46`). Sem rede não é alerta.
- U4 Conflito de sync ≠ da fila: a lista atual só mostra `method path` (`OfflineBar.tsx:67`), não serve a A5.4.
- U5 Import só sem pareamento; substitui tudo, cópia antes, rollback automático.
- U6 Receptor do par vazio, ou Substituir após cópia (0 duplicata, A5.3).
- U7 Mostrar código e exportar pedem `autenticarBiometrico` se houver sensor; sem sensor segue (`f/main.tsx:69-70`).

## Matriz (estado: vê/faz · IDs · Vp)
**Boot** (TelaBackend, `f/components/TelaBackend.tsx:52-76`) — S1/S2
- iniciando: logo, giro, "Abrindo o FinControl…" · A1.1 NF1
- lento (8 s, `:7`): + "Está demorando mais que o normal." · NF1
- falhou: título, motivo, "Seus dados não foram alterados.", Tentar de novo; Android sem "Abrir pasta". Motivos: Keystore ilegível (K3), migration revertida, sem espaço · A1.3 A2.2 · C
- pronto: Login/Bloqueio/App. Resume quente: nada; processo morto: volta a iniciando (K2) · NF1 · C
- import interrompido (staging limpo no boot): barra "Importação interrompida; dados anteriores mantidos." · A1.3

**PrimeiroUso** (modo local, `contaConfigurada()===false`, `f/pages/Login.tsx:120-126`) — S4/S9
- Começar do zero → cadastro atual (`Login.tsx:376`) · A7.2
- Importar backup → AssistenteImport ANTES do cadastro (o backup traz a conta); depois, login com senha/TOTP da VPS · A6.1
- Parear → cadastro local (credencial não sincroniza, A5.1) → Parear (receptor) → 1º sync · A5.6 A6.2
- Opção sem fatia entregue fica oculta; só 1 = cadastro direto, como hoje · A7.2

**AssistenteImport** (1º uso ou Config › Dados) — S4/S10
- escolher: "Escolher arquivo" abre seletor nativo (Android SAF, desktop Tauri), não multipart (teto 25 MB, `backend/app/main.py:139-142`); sem arrastar no v1. `.age` → "Backup cifrado: decifre fora do app" (K6); pareado → "Desconecte o sync antes" (U5) · A1.4
- conferindo (dry-run): por tabela linhas + soma `valor_cents`, anexos n/sha256, esquema, avisos; Importar/Cancelar; com dado local: "substitui os dados; fica uma cópia" · A6.1
- progresso: passos com ✓ cópia → conferir → aplicar (atômico) → anexos n/m → verificação; `role=status`; Cancelar até "aplicar" · A1.3 A3.1
- verificado: esperado = obtido, integrity_check ok, 100% sha256 → "Conferido" + Entrar · A6.1 NF5
- erro/divergência: qual tabela/anexo; nada aplicado; "Dados anteriores mantidos"; Tentar de novo · A1.3 NF5
- C: lista "tabela · linhas · R$"; D M: tabela de 4 colunas

**Status de sync** (ícone no topo, barra, Config) — S7/S9
- não pareado: nada · A7.2
- em dia: ✓, `aria-label` "Sincronizado às 14:32"; toque sincroniza · A5.2
- sincronizando: giro (parado com reduced-motion, `app.css:499`); 1º sync em tela cheia n/m · A5.2 NF7
- offline: nuvem riscada, "Sem conexão · N alterações locais"; sem barra · A5.3 NF6
- erro{codigo}: barra com motivo, Tentar de novo, Detalhes→Config; canal fora: "o app segue normal" · A5.5
- revogado: barra "Este aparelho foi desconectado" + Parear de novo · A5.6
- conflito: ponto no ícone, barra "N conflitos", Resolver → /conflitos · A5.4
- anexo > 5 MB sem Wi-Fi: Config "N anexos aguardam Wi-Fi"; AnexoCampo "não baixado" · A5.1 Q4
- C só ícone (topo cheio em 360); D M ícone + hora

**/conflitos** — S7
- lista: cartão por linha (tabela + descrição), só campos que diferem, formatados; "Este aparelho (hh:mm)" × "‹outro› (hh:mm)" · A5.4
- por item: Manter deste / do ‹outro›; exclusão × edição: Manter excluído / Restaurar com a edição · A5.4 NF5
- lote: Manter todos deste / do ‹outro› → `Modal` (`f/components/Modal.tsx:12`) com contagem · A5.4
- resolvido: item sai + Toast; some no outro no próximo sync; escolhas opostas = novo conflito · NF5
- vazio: "Nenhum conflito" + Início
- C versões empilhadas, botões 100%; D M 2 colunas, lote no topo

**Parear** — S9 [Q1]
- emissor (Config › Sincronização, após U7): código de 8 caracteres (encontro, não segredo) + QR + 10 min; "Aguardando o outro" · A5.6
- receptor: digitar (aceita colar) ou Ler QR; sem leitor, só digitar · A5.6
- confirmar nos 2: mesmos 6 dígitos (SAS) + nome; cada lado toca "Os números batem"; diferentes → Cancelar · A5.6 A5.5
- sucesso: "Pareado com ‹nome›"; receptor vai ao 1º sync (Cancelar desfaz) · A6.2 NF7
- código errado: erro no campo, mantém o digitado; 5 erros invalidam · A5.6
- expirado: "Código expirou" + Gerar outro · A5.6
- receptor com dados: Exportar backup, depois Substituir (cópia antes), ou Cancelar · A5.3
- D M: emissor (QR 200 px); C: receptor

**Configurações** (`f/pages/Config.tsx`) — S3/S4/S7/S9
- IA (`:255-288`): "criptografada neste aparelho e não sincronizada"; modelo sincroniza; teste sem rede = erro legível · A4.1 A4.2
- Sincronização (nova): não pareado → Parear novo aparelho / Tenho um código; pareado → aparelhos + último sync, Sincronizar agora, conflitos, anexos aguardando, Revogar (confirm) · A5.2 A5.6
- Dados e backup (substitui `:406-415`): Exportar zip (casca salva/compartilha), Importar → Assistente; desktop mantém Abrir pasta; Android: caminho, tamanho e "desinstalar apaga os dados deste aparelho" (K3) · A1.4
- ocultas no Android local (como no desktop): Passkeys, Sessões, Servidor, Push (`:323-384,419`) · A1.1
- coluna de 560 px atual

**Bloqueio Android** (`f/components/Bloqueio.tsx`, `f/bloqueio.ts:8`) — S1
- frio: pronto → `carregarSessao` → `bloquearNaCarga` (`f/main.tsx:153-157`) → Bloqueio; 0 dado antes · A2.2
- volta ≥ 5 min com sensor e sessão: Bloqueio; < 5 min: nada; processo morto: caminho frio · NF1
- Entrar com senha: login local · A5.1
- sync ao voltar roda atrás do Bloqueio; ícone/barra só após desbloquear · A5.2 (Bloqueio: C)

**Web/PWA pós-corte (Q2)** — S10/S11
- S10 só leitura: barra "Somente leitura: os dados agora ficam nos aparelhos"; escrita = erro; APK casca avisa pelo BannerVersao (`f/components/BannerVersao.tsx:17-24`) · A6.3
- S11, Q2=sim: página estática + links de download, sem login; sw.js autodestrutivo (padrão `TAREFAS_PENDENTES.md:160-166`) que também apaga o IndexedDB (`f/offline/banco.ts`) · A6.3
- Q2=não: sem desenho (dado em claro fere A5.5)

## Premissas
Q1=A, Q3/Q4 na rec.; 1 conta por aparelho.

## Conflitos
- C1 A5.1 (credencial local) × A6.1 (linhas = VPS): a conta mora em `config` (`backend/app/auth.py:327,340-348`) e vem no backup → import antes do cadastro; sem sessão só com banco virgem, token local e sem par (ArqBackend).
- C2 PC e celular com dados independentes: U6 obriga substituir um; product/sprint não preveem.
- C3 BannerVersao fica desligado no Android local (front e back no mesmo APK): sem aviso de versão (O6).
- C4 resolvido: chave sem auth do usuário, não invalida com digital nova; Bloqueio só na UI.

## Questões abertas
O1 biometria durante o boot se NF1 frio > 3 s (S0) · O3 leitor de QR (plugin novo) ou só digitar · O4 expor "Desfazer importação" (cópia em `backups/`) · O5 conflito campo a campo (v1: linha) · O6 aviso de versão pós-corte.

## Verificação
- V1 Cada estado: teste de componente (como `TelaBackend.test.tsx`).
- V2 Capturas C 360/412, D, M por tela nova: 0 rolagem lateral em 360, alvo ≥ 48 px.
- V3 axe, `role=status/alert`, foco no título por passo, reduced-motion.
- V4 A7.2: sem pareamento, topo e Config do desktop iguais a hoje.
- V5 Aparelho real (HA1/HA2): import (S4/S10), parear e conflito nos 2 lados (S9).
