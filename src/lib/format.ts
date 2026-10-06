import { loadTrip } from './data';

const locale = loadTrip().locale;

// ISO dates are parsed as UTC; format in UTC so the day never shifts.
export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

export const formatNumber = (n: number, digits = 0) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);

export const formatMoney = (n: number, currency: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

export const formatUnit = (n: number | null | undefined, unit: string, digits = 1) =>
  n == null
    ? '?'
    : new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: digits }).format(n);

export const formatPercent = (n: number | null | undefined, digits = 0) =>
  n == null ? '?' : `${formatNumber(n, digits)} %`;

/** "16 janv." from an MM-DD key. */
export const formatDayMonth = (md: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`2000-${md}T00:00:00Z`));

export const formatDayNumber = (md: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(new Date(`2000-${md}T00:00:00Z`));
