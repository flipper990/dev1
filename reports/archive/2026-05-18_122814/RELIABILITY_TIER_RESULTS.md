# RELIABILITY_TIER_RESULTS

| Tier | Passed | Failed | Success % | Main Failure Cause | Production Status |
|---|---:|---:|---:|---|---|
| Tier 1 (simple landing/dashboard) | 0 | 2 | 0.0% | `INVALID_PACKAGE_JSON` (`strict-react-next-bundle-pins`) during slice-1 integrity gate | Not production-ready |
| Tier 2 (multi-page SaaS/CRUD/admin) | 0 | 2 | 0.0% | `INVALID_PACKAGE_JSON` (`strict-react-next-bundle-pins`) during slice-1 integrity gate | Not production-ready |
| Tier 3 (auth/full-stack/API-connected) | 0 | 3 | 0.0% | `INVALID_PACKAGE_JSON` (`strict-react-next-bundle-pins`) during slice-1 integrity gate | Not production-ready |

## Rule-Based Focus
Tier 1 is below 8/10, so next reliability work should focus only on Tier 1 stability before optimizing higher tiers.
