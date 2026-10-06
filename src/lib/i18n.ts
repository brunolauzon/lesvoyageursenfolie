import fr from '../i18n/fr.json';

type Dict = typeof fr;

/** t('home.heading') or t('home.trip', { start: '…' }) */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], fr as Dict);
  if (typeof value !== 'string') throw new Error(`Clé i18n manquante : ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
