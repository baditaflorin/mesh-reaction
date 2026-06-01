import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-reaction",
  description: "Group reflex game — phones flip at a synced moment, fastest tap wins",
  accentHex: "#2ecc71",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
