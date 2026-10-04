// PII redaction for transcript text. Dependency-free and deliberately
// conservative: record numbers, amounts, codes and dates must survive.

export type RedactionCounts = { email: number; iban: number; card: number; phone: number };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Country code, two check digits, then 10 to 30 alphanumerics in optional groups of four.
const IBAN = /\b[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]{4}){2,7}(?:[ ]?[A-Za-z0-9]{1,3})?\b/g;
// 13 to 19 digits, optionally grouped by spaces or dashes.
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
// International form (+41 ..., 0041 ...) or a national number starting with 0
// that has at least 9 digits. Dots are not accepted as separators so dates
// and amounts are left alone.
const PHONE_INTL = /(?:\+|\b00)[1-9]\d{0,2}(?:[ \-\/]?\(?\d{1,5}\)?){2,6}\b/g;
const PHONE_NATIONAL = /\b0\d{1,4}(?:[ \-\/]?\d{2,4}){2,5}\b/g;

const digits = (s: string) => s.replace(/\D/g, "").length;

export function redactWithCounts(text: string): { text: string; counts: RedactionCounts } {
  const counts: RedactionCounts = { email: 0, iban: 0, card: 0, phone: 0 };
  let out = text.replace(EMAIL, () => (counts.email++, "[EMAIL]"));
  out = out.replace(IBAN, (m) => {
    // Require at least 15 characters in total so short codes are not caught.
    if (m.replace(/ /g, "").length < 15) return m;
    counts.iban++;
    return "[IBAN]";
  });
  out = out.replace(PHONE_INTL, (m) => {
    if (digits(m) < 8) return m;
    counts.phone++;
    return "[PHONE]";
  });
  out = out.replace(CARD, () => (counts.card++, "[CARD]"));
  out = out.replace(PHONE_NATIONAL, (m) => {
    if (digits(m) < 9) return m;
    counts.phone++;
    return "[PHONE]";
  });
  return { text: out, counts };
}

export function redact(text: string): string {
  return redactWithCounts(text).text;
}
