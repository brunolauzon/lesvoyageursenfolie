import { loadTrip } from './data';

const locale = loadTrip().locale;

// ISO dates are parsed as UTC; format in UTC so the day never shifts.
export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

export const formatNumber = (n: number, digits = 0) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);

export const formatMoney = (n: number, currency: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
