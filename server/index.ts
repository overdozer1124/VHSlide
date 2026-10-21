import { createApplication } from "./app.ts";

const port = Number(process.env.PORT || 3000);
const clientId = process.env.GOOGLE_CLIENT_ID || "";
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
if (
  process.env.NODE_ENV === "production" &&
  clientId &&
  !origin.startsWith("https://")
)
  throw new Error("PUBLIC_ORIGINにRailwayのHTTPS URLを設定してください。");
const app = createApplication({
  directory: process.env.DATA_DIR || "./data",
  origin,
  clientId,
});
app.server.listen(port, "0.0.0.0", () =>
  console.log(
    `VHSlide server listening on port ${port}; Google sign-in ${clientId ? "configured" : "not configured"}`,
  ),
);
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
