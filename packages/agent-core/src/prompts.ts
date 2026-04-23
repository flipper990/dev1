// -----------------------------------------------------------------
// Production prompt templates for all 8 agents
// Each prompt lives in its own file under ./prompts/
// -----------------------------------------------------------------

import { plannerPrompt } from './prompts/planner';
import { architectPrompt } from './prompts/architect';
import { developerPrompt } from './prompts/developer';
import { reviewerPrompt } from './prompts/reviewer';
import { testerPrompt } from './prompts/tester';
import { debuggerPrompt } from './prompts/debugger';
import { devopsPrompt } from './prompts/devops';
import { optimizerPrompt } from './prompts/optimizer';
import { intentExpanderPrompt } from './prompts/intent-expander';
import { qualityEnforcerPrompt } from './prompts/quality-enforcer';

export const PROMPTS = {
  intent_expander:  intentExpanderPrompt,
  planner:          plannerPrompt,
  architect:        architectPrompt,
  developer:        developerPrompt,
  reviewer:         reviewerPrompt,
  tester:           testerPrompt,
  debugger:         debuggerPrompt,
  devops:           devopsPrompt,
  optimizer:        optimizerPrompt,
  quality_enforcer: qualityEnforcerPrompt,
};

export {
  plannerPrompt, architectPrompt, developerPrompt, reviewerPrompt,
  testerPrompt, debuggerPrompt, devopsPrompt, optimizerPrompt,
  intentExpanderPrompt, qualityEnforcerPrompt,
};
