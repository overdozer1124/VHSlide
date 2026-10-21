import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../../server/app.ts";

// Only this test entry point injects identities. Production has no test-login route.
const directory = await mkdtemp(join(tmpdir(), "vhslide-browser-"));
const app = createApplication({
  directory,
  origin: "http://127.0.0.1:3187",
  clientId: "test.apps.googleusercontent.com",
  verifyIdentity: async (credential) => {
    if (!/^[a-z-]+$/.test(credential)) throw new Error("invalid test identity");
    return {
      id: credential,
      name: credential,
      email: `${credential}@example.test`,
    };
  },
});
app.server.listen(3187, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app
      .close()
      .then(() => rm(directory, { recursive: true, force: true }))
      .then(() => process.exit(0));
  });
