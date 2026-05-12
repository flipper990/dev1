// Single source of truth for combining the two independent backend
// status fields the dashboard renders for a project:
//
//   • project.status                 — generating | generated | failed
//                                      (generation pipeline)
//   • project.preview.previewStatus  — idle | preparing | installing |
//                                      building | starting | reachable |
//                                      ready |
//                                      failed
//                                      (preview / dev-server lifecycle)
//
// IMPORTANT — no success masking. Earlier revisions of this helper
// rewrote `project.status === 'failed' && previewStatus === 'ready'`
// into an `effective: 'generated'` so the header pill would not
// contradict a working iframe. That was unsafe: it hid real backend
// failures and could misreport a broken app as successful. The UI
// must NEVER invent success — it may surface that two statuses
// disagree, but it must render whichever raw label the backend
// persisted, verbatim.
//
// What this module DOES expose:
//
//   • the two raw labels (`projectStatus`, `previewStatus`) for direct
//     rendering by every UI surface (header, recent-card, sidebar,
//     PreviewStage); and
//
//   • a derived `consistency` state — `in_sync` | `conflicting` —
//     used to decide whether to show a small warning banner +
//     trigger a re-hydrate. Conflicting state never alters the
//     pills themselves, only the banner.

import type { GeneratedProject } from '../types/dashboard';

export type RawProjectStatus = 'generating' | 'generated' | 'failed';

export type RawPreviewStatus =
  | 'idle' | 'preparing' | 'installing' | 'building'
  | 'starting' | 'reachable' | 'ready' | 'failed';

export type ConsistencyState = 'in_sync' | 'conflicting';

export interface StatusReconciliation {
  /** Raw backend `project.status` (verbatim, no masking). UI surfaces
   *  render this as the BUILD pill. */
  projectStatus: RawProjectStatus;
  /** Raw persisted preview lifecycle status (verbatim). UI surfaces
   *  render this as the PREVIEW pill. `null` when the project has no
   *  preview block yet (e.g. fresh `generating` row). */
  previewStatus: RawPreviewStatus | null;
  /** Derived: whether the two statuses make sense together. The UI
   *  uses this ONLY to show a warning banner + trigger a re-hydrate;
   *  it never rewrites either pill. */
  consistency: ConsistencyState;
  /** Free-text explanation surfaced in the dev-mode debug overlay
   *  and in the warning banner copy. */
  reason: string;
}

/** Returns true if the (project, preview) pair is logically
 *  contradictory enough to warrant a refresh banner. The ONLY pair
 *  treated as conflicting is `project.failed` + `preview.ready`:
 *  the build cannot have hard-failed if the dev server is running.
 *  Every other combination — including `generating` + `ready` (a
 *  prior preview from a re-generation) and `generated` + `failed`
 *  (a healthy build whose preview later crashed) — is a legitimate
 *  transient. */
function deriveConsistency(
  projectStatus: RawProjectStatus,
  previewStatus: RawPreviewStatus | null,
): { state: ConsistencyState; reason: string } {
  if (projectStatus === 'failed' && previewStatus === 'ready') {
    return {
      state: 'conflicting',
      reason:
        'Backend reports project.status=failed but preview.previewStatus=ready. ' +
        'The dashboard is refreshing from the backend; the pills above show the ' +
        'raw values until reconciliation completes.',
    };
  }
  return { state: 'in_sync', reason: 'in-sync' };
}

export function reconcileProjectStatus(
  p: GeneratedProject | null | undefined,
): StatusReconciliation {
  if (!p) {
    return {
      projectStatus: 'generating',
      previewStatus: null,
      consistency: 'in_sync',
      reason: 'no-project',
    };
  }
  const projectStatus = ((p.projectStatus ?? p.status) as RawProjectStatus) ?? 'generating';
  const previewStatus = (p.preview?.previewStatus ?? null) as RawPreviewStatus | null;
  const { state, reason } = deriveConsistency(projectStatus, previewStatus);
  return { projectStatus, previewStatus, consistency: state, reason };
}
