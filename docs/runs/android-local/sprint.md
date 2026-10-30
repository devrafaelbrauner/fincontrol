# Programa v2 — fincontrol-a0-android-sync
Fontes: product.md, arch-backend (AB), arch-frontend (AF), ux-matrix, DECISIONS §7–10. 1 fatia = 1 run `full` nova, ≤ 20 arquivos (n = estimativa AB+AF). Toda saída: A7.1 (suíte + smoke desktop verdes) e A7.2. 2 runs falhando: humano. NF* *proposed*: medir; gate só com aceite. **OD** = Open Design antes do front.
APK: sabor `local` (`.local`) convive com o `nuvem` (APK de hoje, intocado) de S1a a S9; `.local` fica como app final (QF1). Gatilho do sync é do cliente (`f/sync/agendador.ts`, AF D8).
[livre] roda com Q1 aberta · **[Q1]**/**[Q2]** bloqueada.

## Gate
**S0 Spike (go/no-go)** · feature · [livre] · 17 · Pré HA1
APK `.local` (Chaquopy 17.2, Python 3.13, arm64-v8a); pydantic-core 2.50.2 por cibuildwheel; `requirements-android.txt` sem webauthn/pywebpush, uvicorn sem `[standard]`; webauthn só fora do modo local.
Go (tudo): `import app.main` + bind 127.0.0.1:0 + health com prova HMAC no aparelho; `.so` alinhados a 16 KB; o WebView `.local` (origem `https://localhost`) faz `fetch http://127.0.0.1:<p>/api/health` → 200 sem `allowMixedContent` nem prompt (AF V2); NF1/NF3 gravados; APK `nuvem` sem `libpython`; desktop verde.
Desvio, não no-go: V2 falha → ponte pelo plugin (QF4), S1a/S1b reestimadas; `nuvem` não isolado → congelar em 1.2.1 (QF3).
No-go (pydantic-core não sai em 2 runs, ou boot frio > 20 s): S1a em diante param; humano escolhe (a) ficar como hoje e reforçar `f/src/offline/fila.ts` (patch) ou (b) programa novo sem Pydantic v2 (fere R1). S2a e S4a seguem valendo (VPS/desktop).

## M1 — celular offline sozinho
**S2a Commit antes da resposta** · patch · [livre] · ~18–20 · Pré —
`Depends(get_db, scope="function")` nos routers, `fastapi>=0.121` (O5). Sem Android: pode ser a 1ª run. Base de A3.1/NF5 na VPS e no desktop. Saída: erro no commit = 500, nunca 200.
**S1a Casca Android** · feature · [livre] · 15 · Dep S0 · Pré HA1
Sabores Gradle, `FinControlApp`/`RuntimeBackend`/`CofreBackend`/plugin `BackendLocal`, NSC só 127.0.0.1, `b/android.py`, guarda com Origin Android. Fecha A2.1, A2.2, A2.3 (via NSC, AF C1). Saída: 401/400/403; porta só em 127.0.0.1; segredo fora do logcat e de `files/`.
**S1b Modo local no front** · feature · [livre] · 11 · Dep S1a · Pré HA1
`isBackendLocal()`, adaptador Tauri×Capacitor em `backendLocal.ts`, TelaBackend, 0 SW no `.local`, Bloqueio. Fecha A1.1 (boot). Saída: vitest com plugin stub; boot frio/quente no aparelho.
**S2 Offline + ciclo de vida** · feature · [livre] · 13 · Dep S1b, S2a · Pré HA1
Só-servidor oculto/404, migration com cópia+transação, `quick_check`. Fecha A1.1, A1.2 (sem sync), A1.3, A3.1. Saída: modo avião; 20× force-stop ok.
**S3 IA no aparelho** · patch · [livre] · 2 · Dep S2 · Pré HA6
Fecha A4.1, A4.2 (Q3: por aparelho).
**S4a Import/export backend** · patch · [livre] · 9 · Dep S2a · Pré HA3
Zip único, staging, dry-run, relatório, aplicar atômico. Sem Android; fecha também a etapa 5 do desktop (backend). Fecha A1.4, A6.1 (ensaio). Saída: relatório origem = destino; import interrompido = banco intacto.
**S4b Import/export UI** · feature · [livre] · 13 · **OD** · Dep S4a, S1b · Pré HA5 antes de dado real no celular
PrimeiroUso, AssistenteImport, Config › Dados, diálogo Tauri/SAF. Fecha A1.4, A6.1 (UI). Saída: estados da ux-matrix testados; capturas C/D/M.
**M1 = S0, S2a, S1a–S4b verdes.**

## M2 — sync
**S5 Modelo** · patch · [livre] · 6 · Dep S0=go
m/019 `sync_linha`/`sync_estado`, triggers nas 14 tabelas + config, gids. Saída: 14×3 triggers; 0 router muda.
**S6 Motor** · feature · [livre] · 11 · Dep S5
Lote AEAD+Ed25519, aplicar/conflito, anexos, `TransporteArquivo`. Fecha A5.1, A5.3, A5.4 (motor), A5.5 (cifra), NF5. Saída: 50 escritas/lado, checksum igual, 0 dup, 0 LWW, replay recusado.
**S7 UI de sync + agendador** · feature · [livre] · 14 · **OD** · Dep S6, S1b
`f/sync/*`, IndicadorSync, /conflitos, `/api/sync/estado|agora`. Fecha A5.4 (UI), A5.2 (gatilhos). Saída: relógio falso (AF V5); A7.2.
**S8 Canal** · feature · **[Q1]** · 12 se A · Dep S6 · Pré Q1, HA4 (se A)
A: hub na VPS (O2: convite no `.env`); B/C: reestimar. Fecha A5.5 (canal), NF6. Saída: assinatura, GC, busca = 0.
**S9 Pareamento** · feature · **[Q1]** · 16 · **OD** · Dep S2, S4b, S7, S8 · Pré HA1, HA2, **O1**
X25519+SAS, código digitado (QF2), revogar, > 5 MB só em Wi-Fi (Q4). Fecha A5.6, A5.2, A5.1, A1.2 fim a fim; mede NF2, NF4, NF7. Saída: celular ↔ PC real; 10 min em 2º plano = 0 sync.
**M2 = S5–S9 em aparelhos reais.**

## M3 — saída da VPS
**S10 Corte** · patch · [Q1 via S9] · ~7 · Dep S4b, S9 · Pré HA3 novo, HA5, HA2
VPS só leitura + barra no web; import final; 2º via sync. Fecha A6.1, A6.2. Saída: relatório igual nos 2 e à VPS; aceite do dono.
**S11a Web** · feature · **[Q2]** · ≤ 20 · Dep S10 + aceite · Pré Q2, HA4
Página estática, sw autodestrutivo, −passkey/push/.ics/servidor. Fecha A6.3 (web).
**S11b iOS + nuvem** · patch · **[Q2]** · Dep S11a
−`frontend/ios/`, −sabor `nuvem`. Fecha A6.3.

## Caminho crítico
HA1 → S0 → S5 → S6 → S7 → **Q1** → S8 → S9 → S10 → S11a. Folga: S2a e S4a (rodam antes de S0 se HA1 atrasar); S1a–S4b até S9.
Ordem: S0 (brief pronto; sem HA1, S2a vem antes), S2a, S1a, S1b, S2, S3, S4a, S4b, S5, S6, S7, S8, S9, S10, S11a, S11b.
Pendentes do humano: HA1 (S0+), Q1 (até o fim de S7), O1 (antes de S9), Q2 (S11), aceite NF1–NF7.
