import {
  resolveAppLocale,
  translate,
  type AppLocale,
  type MessageKey,
} from '../shared/i18n';
import {
  RENDERER_STATE_KEY,
  readPersistedRendererState,
  writePersistedRendererState,
} from './persisted-state';

const detectInitialLocale = (): AppLocale => {
  const persistedLocale = readPersistedRendererState().ui?.locale;
  if (persistedLocale) {
    return resolveAppLocale(persistedLocale);
  }

  return resolveAppLocale(navigator.languages[0] ?? navigator.language);
};

const state = $state({
  locale: detectInitialLocale(),
});

document.documentElement.lang = state.locale;

window.addEventListener('storage', (event) => {
  if (event.key !== RENDERER_STATE_KEY) {
    return;
  }

  const nextLocale = detectInitialLocale();
  state.locale = nextLocale;
  document.documentElement.lang = nextLocale;
});

export const i18n = {
  get locale(): AppLocale {
    return state.locale;
  },

  setLocale(locale: AppLocale): void {
    const nextLocale = resolveAppLocale(locale);
    state.locale = nextLocale;
    document.documentElement.lang = nextLocale;
    writePersistedRendererState({
      ui: {
        locale: nextLocale,
      },
    });
  },

  t(
    key: MessageKey,
    values?: Readonly<Record<string, string | number>>,
  ): string {
    return translate(state.locale, key, values);
  },
};
