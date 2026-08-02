import type { CapacitorConfig } from '@capacitor/cli';

// Teste em rede local: a página (https://localhost) consome a API em
// http://<ip-do-mac>, e o WebView bloqueia mixed content por padrão.
// Fica atrás de uma variável porque "remover antes de publicar" é o tipo de
// lembrete que não sobrevive — assim o build de produção sai seguro por padrão:
//   FINCONTROL_ANDROID_TESTE_LOCAL=1 npx cap sync android
const testeLocal = process.env.FINCONTROL_ANDROID_TESTE_LOCAL === '1';

// Bundle id pode ser trocado antes de publicar (precisa ser único na sua conta Apple).
const config: CapacitorConfig = {
  appId: 'com.rafaelbrauner.fincontrol',
  appName: 'FinControl',
  webDir: 'dist',
  // Cor por trás do WebView (evita flash branco no boot; casa com o tema escuro padrão).
  // Mesma cor em: src/tema.ts, index.html e vite.config.ts (manifest).
  backgroundColor: '#000000',
  ios: {
    backgroundColor: '#000000',
    // Respeita as safe areas (notch/Dynamic Island) sem cortar conteúdo.
    contentInset: 'always',
  },
  android: {
    allowMixedContent: testeLocal,
  },
};

export default config;
