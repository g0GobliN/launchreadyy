/**
 * Sampling temperature for every provider call.
 *
 * No temperature was set anywhere, so each provider ran at its own default — DeepSeek's chat
 * default is 1.0. That is a reasonable default for open-ended chat and a poor one for this
 * product: essentially everything generated here is code or structured text (test suites, CI
 * YAML, Dockerfiles, `.env.example`, JSON) where there is a right answer and creative variation
 * only produces output that fails validation, fails the sandbox, or differs run to run for the
 * same repository.
 *
 * 0.2 rather than 0: a little sampling still helps when a retry follows a failure, and some
 * providers behave oddly at exactly 0.
 *
 * Deliberately one value rather than a per-task table. Every current task type is
 * structured-output generation, so a table would be a lot of surface area encoding the same
 * number. Split it per `TaskType` if a genuinely open-ended task is ever added.
 */
export const AI_TEMPERATURE = 0.2;

/**
 * Models that reject an explicit temperature.
 *
 * OpenAI's reasoning models (o1/o3/o4, gpt-5 reasoning tiers) return a 400 when `temperature` is
 * sent at all, so the parameter has to be omitted rather than clamped for them.
 */
export function supportsTemperature(model: string | undefined): boolean {
  if (!model) return true;
  return !/^(o[1-9]|gpt-5)/i.test(model.trim());
}
