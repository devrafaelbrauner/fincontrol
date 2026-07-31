import type { CapacitorConfig } from '@capacitor/cli';

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
};

export default config;
