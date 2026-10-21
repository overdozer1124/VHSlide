import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness } from "./harness.ts";
const storage = await mkdtemp(join(tmpdir(), "vhslide-cf-browser-"));
const fixture = await harness(storage, "http://127.0.0.1:3187", 3187);
const mf = fixture.start();
await mf.ready;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void mf
      .dispose()
      .then(() => rm(storage, { recursive: true, force: true }))
      .then(() => process.exit(0));
  });
