import { app } from "./app.js";
import { pruneExpired } from "./cleanup.js";
import { cleanupIntervalMs, host, port } from "./config.js";

pruneExpired();
setInterval(pruneExpired, cleanupIntervalMs).unref();

app.listen(port, host, () => {
  console.log(`teleport listening on http://${host}:${port}`);
});
