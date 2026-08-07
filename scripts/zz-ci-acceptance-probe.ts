// THROWAWAY — P2 acceptance-criterion probe (docs/reviews/p2-ci-gates.md).
// Deliberately violates no-explicit-any so stage 1's lint job can be
// observed failing for a real reason, not just a missing secret. Removed
// on the same branch once the RED run is captured; this PR is never merged.
const x: any = 1
