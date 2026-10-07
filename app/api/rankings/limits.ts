export const MAX_STANDINGS_ROWS = 50_000;
export const MAX_STANDINGS_PROBLEMS = 1_000;
// Bound the dense matrix and its response copies, not just sparse input rows.
// This permits 2,000 standing rows × 10 problems without allocating millions of cells.
export const MAX_STANDINGS_CELLS = 20_000;
