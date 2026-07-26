# UI Hierarchy Report

## Primary hierarchy

1. **Project identity and status**
   - Project name is the page title.
   - Status and stack remain compact project metadata.
   - One contextual primary action appears in the page header.

2. **Workbench mode**
   - Preview, Code, Logs, and Diagnostics remain visible at all times.
   - Only one mode owns the central stage at a time.
   - Mode selection is reflected in the URL.

3. **Current work**
   - The command dock remains close to the workbench and sticky on larger screens.
   - Progress and execution evidence move to the right context rail rather than competing with the central task.

4. **Global navigation**
   - Global destinations are reduced to unique, durable locations.
   - Workspace-specific modes no longer appear as duplicate global destinations.

## Noise reduction

The previous workspace combined an always-visible preview, a collapsed evidence disclosure, seven hidden tabs, duplicated primary actions, duplicate navigation destinations, passive status chrome, and multiple internal product names.

The redesigned hierarchy removes or consolidates those layers:

- 7 secondary workspace tabs → 4 primary modes
- 11 global navigation items → 7 unique destinations
- 2 competing project actions → 1 primary action
- Preview plus evidence deck → 1 mode-owned workbench stage
- Multiple shell identities → DEVteam + current project
- Passive telemetry and disabled notification controls removed

This materially reduces visual and conceptual noise while preserving the underlying project and runtime contracts.

## User-facing vocabulary

| Previous | Current |
| --- | --- |
| Workspace / Builder | Workspace |
| New mission | New project |
| AI Engineering Runtime | Project workspace / project name |
| Evidence deck | Workbench |
| Preview state | Preview |
| Logs + evidence | Logs |
| Verification | Diagnostics |
| Agent Pipeline | Project context |
| Runtime iteration mode | Existing project context |

## Interaction priorities

- Global navigation answers: “Where am I in the product?”
- Workbench modes answer: “What am I inspecting?”
- Project context answers: “What is happening now?”
- The command dock answers: “What do I want to change next?”
- The primary action answers: “What is the next lifecycle step?”

## Accessibility and responsiveness

- Existing accessible tab semantics and keyboard behavior are retained.
- Mode content uses a labelled tab panel.
- File selection uses native buttons with visible focus states.
- Desktop panels have independent scrolling.
- Context stays out of the central column until the viewport can support three panes.
