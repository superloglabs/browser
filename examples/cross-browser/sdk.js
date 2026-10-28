import * as Superlog from "@superlog/browser";

Superlog.init({ endpoint: "https://intake.test", ingestKey: "test-key", release: "2026.10.28", service: "storefront" });
Superlog.setUser({ id: "user-7" });
window.Superlog = Superlog;
