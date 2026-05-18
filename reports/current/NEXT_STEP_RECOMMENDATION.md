# Next Step Recommendation

1. Keep the current multi-tier lock suite as a required CI gate:
   - router/classifier + tier policies + tier runners + terminal quality + fast contracts + package + API typecheck/build.
2. Keep the capped 6-prompt canary as the only routine orchestration canary for this milestone.
3. Add tier-attribution cleanup in mission reporting (`custom` vs tier bucket) as a follow-up reliability reporting task.
4. Monitor `providerCallCount` and `repairAttemptCount` trends in diagnostics for regression detection over the next release window.