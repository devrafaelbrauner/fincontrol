import type { CapacitorConfig } from '@capacitor/cli';

// Bundle id pode ser trocado antes de publicar (precisa ser único na sua conta Apple).
const config: CapacitorConfig = {
  appId: 'com.rafaelbrauner.fincontrol',
  appName: 'FinControl',
  webDir: 'dist',
  // Cor por trás do WebView (evita flash branco no boot; casa com o tema escuro padrão).
  backgroundColor: '#0d0d12',
  ios: {
    backgroundColor: '#0d0d12',
    // Respeita as safe areas (notch/Dynamic Island) sem cortar conteúdo.
    contentInset: 'always',
  },
};

export default config;
