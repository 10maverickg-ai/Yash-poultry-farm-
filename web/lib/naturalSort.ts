// Natural/numeric ordering for flock display labels — "BAB-2" before
// "BAB-10", not after, the way plain string ordering puts it. Single
// source of truth for "what order do flocks sort in" so the Production
// entry screen, Flocks screen, Records screen, Feed Bags screens, the
// "Choose a flock" dropdown, and the upload result all agree, and a newly
// added flock (any label, any number) sorts correctly with no code changes.
//
// Comparison happens in JS, not SQL — every call site already has the rows
// in hand (these are small per-farm lists, never paginated), so one shared
// comparator here is simpler and easier to keep in sync than repeating a
// numeric-suffix SQL expression in every query.
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Sorts a copy of `items` by a label derived from each item. Use this when
// natural label order is the only thing that matters for the list.
export function sortByLabel<T>(items: T[], labelOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareLabels(labelOf(a), labelOf(b)));
}
