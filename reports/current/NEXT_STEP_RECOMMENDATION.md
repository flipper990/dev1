# Next Step Recommendation

## Recommended next increment: change review

The new architecture gives Preview, Code, Logs, and Diagnostics stable homes. The highest-value next step is to turn the read-only Code mode into a trustworthy change-review workflow.

### Build next

1. Add a changed-files filter and file status indicators.
2. Add unified and split diffs for each generated change.
3. Connect each prompt/run to its affected files.
4. Add run-level checkpoints and a clear restore action.
5. Add file-level accept, reject, and revert only after the underlying version model is authoritative.

### Why this comes next

- It directly strengthens user control without expanding into enterprise administration.
- It uses the new Code mode rather than creating another panel.
- It connects the command dock, pipeline, source, and diagnostics into one understandable workflow.
- It closes the largest remaining productivity gap relative to Cursor, GitHub, and VS Code.

### Do not prioritize yet

- New global navigation destinations
- Additional dashboard cards
- Enterprise administration placeholders
- More passive pipeline visualization
- More status terminology

### Acceptance criteria

- A user can submit a change, identify the resulting run, inspect every changed file, understand validation results, and restore the prior checkpoint without leaving the workspace.
- The same workflow is usable with keyboard navigation and at 1024px width.
- URLs identify the selected project, workbench mode, run, and file.
- No generated change is presented as accepted before its authoritative state is confirmed.
