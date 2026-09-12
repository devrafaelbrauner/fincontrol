/** Gera o `latest.json` do updater do Tauri 2 a partir dos pacotes buildados.
 *
 * O tauri-action sabe fazer isso, mas publica no MESMO repositório do workflow —
 * aqui o código é privado e os binários vão para um repo público. Então o
 * manifesto é montado à mão, apontando para os assets do repo de releases.
 *
 * Uso:
 *   node scripts/latest-json.mjs --versao 1.2.0 --tag v1.2.0 \
 *     --repo devrafaelbrauner/fincontrol-releases --dir ./artefatos [--notas "..."]
 *
 * Para cada pacote de atualização (`*.app.tar.gz`, `*.msi.zip`, `*.nsis.zip`)
 * com o `.sig` ao lado, monta a plataforma correspondente. O que não casa vira
 * aviso — melhor falhar alto do que publicar um manifesto sem a plataforma. */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const versao = argumento("versao");
const tag = argumento("tag");
const repo = argumento("repo");
const dir = argumento("dir") ?? ".";
const notas = argumento("notas") ?? `FinControl ${versao}`;

if (!versao || !tag || !repo) {
  console.error("faltando --versao, --tag ou --repo");
  process.exit(1);
}

/** Lista recursiva de arquivos. */
function arquivos(base) {
  const saida = [];
  for (const nome of readdirSync(base)) {
    const caminho = join(base, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else saida.push(caminho);
  }
  return saida;
}

const todos = arquivos(dir);
const assets = todos.filter((f) => !f.endsWith(".sig"));

function plataforma(arquivo) {
  const nome = arquivo.toLowerCase();
  const ehUpdater = nome.endsWith(".app.tar.gz") || nome.endsWith(".msi.zip") || nome.endsWith(".nsis.zip");
  if (!ehUpdater) return null;
  if (nome.endsWith(".app.tar.gz")) return nome.includes("aarch64") ? "darwin-aarch64" : "darwin-x86_64";
  return "windows-x86_64";
}

const plataformas = {};
for (const arquivo of assets) {
  const chave = plataforma(arquivo);
  if (!chave) continue;
  const sig = `${arquivo}.sig`;
  if (!todos.includes(sig)) {
    console.error(`AVISO: ${arquivo} sem assinatura (${sig}); a plataforma ${chave} ficou de fora.`);
    continue;
  }
  const nome = arquivo.split("/").pop();
  plataformas[chave] = {
    signature: readFileSync(sig, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(nome)}`,
  };
}

if (Object.keys(plataformas).length === 0) {
  console.error("nenhum pacote de atualização assinado encontrado — latest.json não publicado.");
  process.exit(1);
}

const manifesto = {
  version: versao,
  notes: notas,
  pub_date: new Date().toISOString(),
  platforms: plataformas,
};

const destino = join(dir, "latest.json");
writeFileSync(destino, `${JSON.stringify(manifesto, null, 2)}\n`);
console.log(`latest.json escrito em ${destino} com ${Object.keys(plataformas).join(", ")}`);
