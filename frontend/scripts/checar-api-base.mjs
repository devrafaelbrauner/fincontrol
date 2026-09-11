/** Recusa uma VITE_API_BASE que não funcionaria num aparelho de verdade.
 *
 *  A checagem anterior só perguntava se a variável EXISTIA. Foi por essa fresta
 *  que saiu um bundle iOS apontando para `http://127.0.0.1:8001` — num iPhone
 *  físico isso é o loopback do próprio telefone, então nenhum request saía e o
 *  login nunca passava. Não havia erro em lugar nenhum: o app simplesmente não
 *  funcionava, e a URL só era descoberta lendo o JS empacotado.
 *
 *  A base entra em build time e fica congelada no bundle (`webDir: 'dist'`, sem
 *  `server.url`), então o erro só aparece no aparelho, muito depois.
 *
 *  FINCONTROL_BUILD_LOCAL=1 libera http:// e IP privado, para o teste em rede
 *  local documentado no deploy/README.md. `localhost` segue proibido sempre:
 *  no aparelho ele nunca aponta para a sua máquina.
 */

const base = (process.env.VITE_API_BASE ?? "").trim();
const local = process.env.FINCONTROL_BUILD_LOCAL === "1";
// `npm run macos:dev` checa sem exigir https nem host remoto: o dev roda contra
// o backend local (VITE_API_BASE=http://localhost:8000) via `tauri dev`.
const dev = process.argv.includes("--dev");
const exemplo = "VITE_API_BASE=https://seu-dominio npm run <ios|android|macos>";

function erro(problema, dica) {
  console.error(`\nERRO: build nativo com VITE_API_BASE inválida.\n  ${problema}`);
  if (dica) console.error(`  ${dica}`);
  console.error(`\n  Ex.: ${exemplo}\n`);
  process.exit(1);
}

if (!base) {
  erro("A variável está ausente ou vazia.");
}

let url;
try {
  url = new URL(base);
} catch {
  erro(`Não é uma URL absoluta: ${JSON.stringify(base)}.`,
       "Precisa incluir o esquema, ex.: https://fincontrol.seudominio.com");
}

if (url.protocol !== "https:" && url.protocol !== "http:") {
  erro(`Esquema não suportado: ${url.protocol}`);
}

// localhost/loopback no aparelho é o PRÓPRIO aparelho — nunca o seu Mac.
// A faixa inteira 127.0.0.0/8 é loopback, não só o .1 — e o parser de URL já
// normaliza as formas abreviadas (`127.1` e `0177.0.0.1` viram `127.0.0.1`).
// Exceção: `tauri dev` (--dev), que roda o WebView contra a máquina local.
const LOOPBACK = new Set(["localhost", "[::1]", "::1", "0.0.0.0"]);
const ehLoopback = (h) => LOOPBACK.has(h) || /^127\.\d+\.\d+\.\d+$/.test(h);
if (ehLoopback(url.hostname) && !dev) {
  erro(`A base aponta para ${url.hostname}, que no celular é o próprio celular.`,
       "Use o domínio da VPS — ou, para teste em rede local, o IP do Mac com FINCONTROL_BUILD_LOCAL=1.");
}

if (url.protocol === "http:" && !local && !dev) {
  erro(`Base em http:// (${base}).`,
       "Produção exige https. Para o teste em rede local, rode com FINCONTROL_BUILD_LOCAL=1.");
}

console.log(`API base do build nativo: ${base}${local ? "  (modo local)" : ""}`);
