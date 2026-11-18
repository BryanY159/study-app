// @study/pack/engine: the pure parts of the engine a content repo may need,
// e.g. to check that a real bank can fill a mock exam, or to sample questions
// reproducibly. No UI or storage code is reachable from here.

export { indexPack, toUnits } from './packIndex';
export type { PackIndex } from './packIndex';
export { assembleMock } from './mock';
export type { MockAssembly } from './mock';
export { mulberry32, randomSeed, shuffle } from './rng';
export type { Rand } from './rng';
