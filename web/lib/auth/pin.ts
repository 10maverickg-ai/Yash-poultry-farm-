// The staff PIN: 4 to 6 digits. The login box tells a PIN from the owner password by its shape alone (no username anywhere).
export const isPinShape = (entry: string): boolean => /^\d{4,6}$/.test(entry);

/** A plain sentence when the PIN is too easy to guess; null when it is acceptable. */
export function pinProblem(pin: string): string | null {
  if (!isPinShape(pin)) return "A staff PIN is 4 to 6 digits, nothing else.";
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return "That PIN is all the same digit. Choose one that is harder to guess.";
  const step = (k: number) => d.every((x, i) => i === 0 || (x - d[i - 1] + 10) % 10 === k);
  if (step(1) || step(9)) return "That PIN counts up or down (like 1234 or 4321). Choose one that is harder to guess.";
  for (const len of [2, 3]) if (d.length % len === 0 && d.length > len && d.every((x, i) => x === d[i % len])) return "That PIN repeats a short pattern (like 1212). Choose one that is harder to guess.";
  if (["2580", "1357", "2468", "1004", "0852", "6969", "1122", "2000", "2024", "2025", "2026", "123123"].includes(pin)) return "That PIN is one of the most common. Choose one that is harder to guess.";
  return null;
}

/** The owner password must never look like a PIN, or the login box would send it to the PIN check. */
export function ownerPasswordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters (a few words in a row is easy to remember and hard to guess).";
  if (isPinShape(pw) || /^\d+$/.test(pw)) return "The owner password cannot be only digits.";
  return null;
}
