// Public entry point of @study/pack: the content-pack schema and validator.
// Content repos install this repo straight from GitHub at a release tag, which
// keeps the app's import checks and their pipeline's checks identical.
// Changing anything exported here is a format change: tag a new version.

export * from './schema';
export { checkPack, formatIssues, normalizeText, parsePack, zodIssues } from './checks';
export type { CheckResult, Issue, ParseResult } from './checks';
