import { devMockAuthEnabled, port, rpEntityId } from "./config/environment.js";
import { createApp } from "./app/application.js";

const app = await createApp();
app.listen(port, () => {
  console.log(`Federation sign-in app listening on port ${port}`);
  console.log(`RP Entity Identifier: ${rpEntityId}`);
  if (devMockAuthEnabled) {
    console.warn("Development mock sign-in is enabled; simulated identities are not authenticated users.");
  }
});
