// ============================================================
// PHONE NORMALISATION
//
// One function, used by BOTH the profile writer and the match
// checker. If these ever diverge, matching silently breaks and
// we falsely accuse a real seller — so it lives in one place.
//
// Malaysian mobile numbers, every way a human might type them:
//   0123456789        -> 60123456789
//   012-345 6789      -> 60123456789
//   +60 12-345 6789   -> 60123456789
//   60123456789       -> 60123456789
//   +6012 3456789     -> 60123456789
//
// Returns null if the input cannot be a Malaysian mobile number.
// Null is never matched against — a null on either side is a
// non-answer, not a match.
// ============================================================

function normalizePhone(input) {
  if (!input) return null;

  // Strip everything that is not a digit. This kills +, spaces,
  // dashes, brackets, and any invisible characters pasted from
  // WhatsApp or a browser.
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  // Some people paste with a leading 00 international prefix
  if (digits.startsWith('0060')) digits = digits.slice(2);

  // Local format: 01X XXXXXXX -> drop the 0, prepend 60
  if (digits.startsWith('0')) {
    digits = '60' + digits.slice(1);
  }

  // Bare mobile without country code or leading zero: 12345678xx
  // Malaysian mobiles always start with 1 after the country code.
  if (!digits.startsWith('60') && digits.startsWith('1')) {
    digits = '60' + digits;
  }

  if (!digits.startsWith('60')) return null;

  // After 60, a Malaysian mobile starts with 1
  const subscriber = digits.slice(2);
  if (!subscriber.startsWith('1')) return null;

  // Malaysian mobile subscriber part is 9 or 10 digits
  // (60 + 9 = 11 total, 60 + 10 = 12 total)
  if (subscriber.length < 9 || subscriber.length > 10) return null;

  return digits;
}

// Constant-time-ish comparison. Both sides normalised first.
// Returns false if either side is unusable — never throws.
function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}

// Display helper — 60123456789 -> +60 12-345 6789
function formatPhoneDisplay(input) {
  const n = normalizePhone(input);
  if (!n) return input || null;
  const sub = n.slice(2);
  if (sub.length === 9) {
    return `+60 ${sub.slice(0, 2)}-${sub.slice(2, 5)} ${sub.slice(5)}`;
  }
  return `+60 ${sub.slice(0, 2)}-${sub.slice(2, 6)} ${sub.slice(6)}`;
}

module.exports = { normalizePhone, phonesMatch, formatPhoneDisplay };