/**
 * fast-check's global parameters for every Jest file, from the environment.
 *
 * Property tests run fast-check's default 100 cases with a fresh seed each
 * run, so the gate keeps exploring new inputs. A failure prints its seed and
 * shrink path; replay it exactly with
 *
 *   FC_SEED=<seed> FC_PATH=<path> bunx jest --ci --watchman=false <file>
 *
 * `FC_NUM_RUNS` raises the case count (the nightly workflow uses thousands).
 *
 * `jest.setup.js` applies these. fast-check keeps them in module state, so a
 * file that calls `jest.resetModules()` and requires fast-check again gets
 * fast-check's defaults back.
 */
'use strict';

function positiveInteger(name, raw) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function fastCheckParameters(env) {
  const parameters = {};
  if (env.FC_NUM_RUNS) parameters.numRuns = positiveInteger('FC_NUM_RUNS', env.FC_NUM_RUNS);
  if (env.FC_SEED) {
    const seed = Number(env.FC_SEED);
    if (!Number.isSafeInteger(seed)) {
      throw new Error(`FC_SEED must be an integer, got ${JSON.stringify(env.FC_SEED)}`);
    }
    parameters.seed = seed;
  }
  if (env.FC_PATH) {
    if (!env.FC_SEED) throw new Error('FC_PATH replays a failure only together with its FC_SEED');
    parameters.path = env.FC_PATH;
  }
  return parameters;
}

module.exports = { fastCheckParameters };
