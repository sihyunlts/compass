import { en, type MessageKey } from './en';
import { ko } from './ko';

const APP_LOCALES = ['en', 'ko'] as const;

export type AppLocale = typeof APP_LOCALES[number];
export type { MessageKey };

const DEFAULT_APP_LOCALE: AppLocale = 'en';

const catalogs: Readonly<Record<AppLocale, Readonly<Record<MessageKey, string>>>> = {
  en,
  ko,
};

export const isAppLocale = (value: unknown): value is AppLocale =>
  typeof value === 'string' && APP_LOCALES.includes(value as AppLocale);

export const resolveAppLocale = (value: unknown): AppLocale => {
  if (isAppLocale(value)) {
    return value;
  }

  return typeof value === 'string' && value.toLowerCase().startsWith('ko')
    ? 'ko'
    : DEFAULT_APP_LOCALE;
};

export const translate = (
  locale: AppLocale,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string => catalogs[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
  values[name] === undefined ? match : String(values[name]));
