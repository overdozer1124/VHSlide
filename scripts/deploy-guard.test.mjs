import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertNewer,
  assertKnownRelease,
  deployedVersion,
} from "./deploy-guard.mjs";

test("only permits a version strictly newer than production", () => {
  assert.doesNotThrow(() => assertNewer("0.85.0", "0.84.2"));
  assert.doesNotThrow(() => assertNewer("0.84.10", "0.84.9"));
  for (const value of ["0.84.2", "0.83.1", "0.84.1", "0.84.2-beta", "v0.85.0"])
    assert.throws(() => assertNewer(value, "0.84.2"));
});

test("fails closed for missing, ambiguous or split production deployments", () => {
  const deployment = {
    id: "id",
    annotations: { "workers/message": "Deploy 0.84.2: restored" },
    versions: [{ version_id: "v", percentage: 100 }],
  };
  const payload = (d) => ({ success: true, result: { deployments: [d] } });
  assert.deepEqual(deployedVersion(payload(deployment)), {
    version: "0.84.2",
    id: "id",
  });
  assert.throws(() => deployedVersion({ success: false }));
  assert.throws(() =>
    deployedVersion(payload({ ...deployment, annotations: {} })),
  );
  assert.throws(() =>
    deployedVersion(
      payload({
        ...deployment,
        versions: [{ percentage: 50 }, { percentage: 50 }],
      }),
    ),
  );
  assert.throws(() =>
    deployedVersion({ success: true, result: { deployments: [] } }),
  );
});

test("requires the production release to exist in the source history", () => {
  assert.doesNotThrow(() => assertKnownRelease('version: "0.84.2"', "0.84.2"));
  assert.throws(() => assertKnownRelease('version: "0.83.1"', "0.84.2"));
});
