import { en, type MessageKey } from './en';
import { ko } from './ko';
import { zhHans } from './zh-Hans';

const APP_LOCALES = ['en', 'ko', 'zh-Hans'] as const;

export type AppLocale = typeof APP_LOCALES[number];
export type { MessageKey };

const DEFAULT_APP_LOCALE: AppLocale = 'en';

const catalogs: Readonly<Record<AppLocale, Readonly<Record<MessageKey, string>>>> = {
  en,
  ko,
  'zh-Hans': zhHans,
};

export const isAppLocale = (value: unknown): value is AppLocale =>
  typeof value === 'string' && APP_LOCALES.includes(value as AppLocale);

export const resolveAppLocale = (value: unknown): AppLocale => {
  if (isAppLocale(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return DEFAULT_APP_LOCALE;
  }

  const language = value.toLowerCase().split('-')[0];
  if (language === 'ko') {
    return 'ko';
  }
  if (language === 'zh') {
    return 'zh-Hans';
  }
  return DEFAULT_APP_LOCALE;
};

export const translate = (
  locale: AppLocale,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string => catalogs[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
  values[name] === undefined ? match : String(values[name]));
