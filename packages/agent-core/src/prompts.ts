// -----------------------------------------------------------------
// Production prompt templates for the 4-agent simplified pipeline.
// Each prompt lives in its own file under ./prompts/
// All prompts share a common preamble (persona + global rules +
// known-issues memory) defined in ./prompts/shared.
// -----------------------------------------------------------------

import { specPrompt }    from './prompts/spec';
import { builderPrompt } from './prompts/builder';
import { qaPrompt }      from './prompts/qa';
import { polishPrompt }  from './prompts/polish';

export const PROMPTS = {
  spec:    specPrompt,
  builder: builderPrompt,
  qa:      qaPrompt,
  polish:  polishPrompt,
};

export { specPrompt, builderPrompt, qaPrompt, polishPrompt };
export {
  AGENT_PERSONA,
  GLOBAL_RULES,
  KNOWN_ISSUES_MEMORY,
  SHARED_PREAMBLE,
} from './prompts/shared';
