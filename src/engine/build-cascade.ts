import type { CascadeLink } from '../schemas/firstmove-output.js';
import type { RunbookAction, RunbookCascadeLink } from '../playbooks/types.js';

/**
 * Builds the wire cascade from a runbook's dependency edges, wiring each link's
 * `mitigated_by` to the step numbers of the selected actions that reduce it.
 *
 * `mitigated_by` is derived, never authored — it can only reference actions
 * that actually made it into this response.
 */
export function buildCascade(
  cascadeLinks: readonly RunbookCascadeLink[],
  selectedActions: readonly RunbookAction[],
  stepById: Map<string, number>,
): CascadeLink[] {
  return cascadeLinks.map((link) => {
    const mitigatedBy: number[] = [];
    for (const action of selectedActions) {
      if (action.mitigatesCascade?.includes(link.id)) {
        const step = stepById.get(action.id);
        if (step !== undefined) mitigatedBy.push(step);
      }
    }
    mitigatedBy.sort((a, b) => a - b);

    const wire: CascadeLink = {
      id: link.id,
      from: link.from,
      to: link.to,
      mechanism: link.mechanism,
      risk: link.risk,
    };
    if (mitigatedBy.length > 0) wire.mitigated_by = mitigatedBy;
    return wire;
  });
}
