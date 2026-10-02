import {
  addTokens,
  noTokens,
  ReportedCost,
  StatsUsage,
  UsageBucket,
  LongContextTokens,
} from "@polaris/protocol";

/** Combine response-sized buckets without dropping their pricing subsets. */
export const sumUsage = (buckets: ReadonlyArray<UsageBucket>): StatsUsage => {
  const grouped = new Map<string, UsageBucket>();

  for (const bucket of buckets) {
    const key = JSON.stringify([bucket.hour, bucket.harness, bucket.model, bucket.sessionId]);
    const old = grouped.get(key);

    if (old === undefined) {
      grouped.set(key, bucket);
      continue;
    }

    const thresholds = new Set([...old.longContext, ...bucket.longContext].map((l) => l.above));

    grouped.set(
      key,
      UsageBucket.make({
        hour: bucket.hour,
        harness: bucket.harness,
        model: bucket.model,
        sessionId: bucket.sessionId,
        tokens: addTokens(old.tokens, bucket.tokens),
        reportedCost:
          old.reportedCost === null && bucket.reportedCost === null
            ? null
            : ReportedCost.make({
                usd: (old.reportedCost?.usd ?? 0) + (bucket.reportedCost?.usd ?? 0),
                tokens: addTokens(
                  old.reportedCost?.tokens ?? noTokens,
                  bucket.reportedCost?.tokens ?? noTokens
                ),
              }),
        longContext: [...thresholds].map((above) =>
          LongContextTokens.make({
            above,
            tokens: addTokens(
              old.longContext.find((l) => l.above === above)?.tokens ?? noTokens,
              bucket.longContext.find((l) => l.above === above)?.tokens ?? noTokens
            ),
          })
        ),
      })
    );
  }

  return StatsUsage.make({
    tokens: buckets.reduce((t, b) => addTokens(t, b.tokens), noTokens),
    reportedUsd: buckets.reduce((n, b) => n + (b.reportedCost?.usd ?? 0), 0),
    reportedTokens: buckets.reduce(
      (t, b) => addTokens(t, b.reportedCost?.tokens ?? noTokens),
      noTokens
    ),
    buckets: [...grouped.values()],
  });
};
