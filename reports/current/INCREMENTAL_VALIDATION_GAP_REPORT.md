# Incremental Validation Gap Report

## Why validation missed the original failure
- Gap location: UI foundation/sanitizer contract repair coverage.
- Existing validation/repair covered:
  - Alert contract (`className`/`variant`)
  - Button contract (safe anchor/button discriminant)
- Missing coverage (before this fix):
  - dashboard `ActivityFeed -> ActivityItem` prop contract alignment (`activity` prop)

## Should have been caught earlier by
- `UI foundation validation/repair`: **Yes** (now fixed by deterministic repair pass).
- `slice validation`: No direct typed cross-file prop contract enforcement at this stage.
- `import/export validation`: Not applicable (imports were valid; prop type was wrong).
- `api-client contract`: Not applicable.
- `deterministic contract`: Partially (had import/dedupe/api-client guards, but not this prop shape mismatch).
- `final assembly validation`: It surfaced at build/typecheck time; now prevented earlier by sanitizer repair.

## Net effect after fix
- The prior `generated_typescript_error` class for this dashboard mismatch is prevented before preview build.
- On rerun, failure mode moved away from TypeScript prop mismatch to a separate dependency manifest validation issue.
