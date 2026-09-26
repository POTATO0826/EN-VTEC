/**
 * The one number both sides agree on: how much faster than the baseline a
 * kernel must be (by median time) to count as an improvement. The agent uses
 * it to pass or fail a verification; the server uses it to explain the result
 * and to return or slash a stake.
 */
export const MIN_GAIN_PCT = 0.1;
