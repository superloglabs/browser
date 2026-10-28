import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addBreadcrumb, captureException, captureMessage, init, setAttributes, setUser, shutdown } from "./index.js";
import { captureExports, exceptions } from "./test-support.js";

const endpoint = "https://intake.example.com";

function raise(error: unknown) {
  window.dispatchEvent(new ErrorEvent("error", { error, message: error instanceof Error ? error.message : String(error) }));
}

function reject(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

describe("@superlog/browser", () => {
  let exports: ReturnType<typeof captureExports>;

  beforeEach(() => {
    exports = captureExports();
  });

  afterEach(async () => {
    await shutdown();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("sends uncaught errors as OpenTelemetry exception logs", async () => {
    init({ endpoint, environment: "production", ingestKey: "key-1", release: "1.4.2", service: "storefront" });
    raise(new TypeError("Cannot read properties of undefined (reading 'total')"));

    const [error, ...rest] = exceptions(await exports.logs());
    expect(rest).toEqual([]);
    expect(error).toMatchObject({
      attributes: {
        "exception.handled": false,
        "exception.mechanism": "onerror",
        "exception.message": "Cannot read properties of undefined (reading 'total')",
        "exception.type": "TypeError",
        "url.full": location.href,
      },
      body: "Cannot read properties of undefined (reading 'total')",
      resource: {
        "deployment.environment.name": "production",
        "service.name": "storefront",
        "service.version": "1.4.2",
      },
      severityNumber: 17,
    });
    expect(error?.attributes["exception.stacktrace"]).toMatch(/^TypeError: Cannot read properties/);
    expect(error?.attributes["session.id"]).toEqual(expect.any(String));
    expect(exports.requests[0]?.headers.authorization).toBe("Bearer key-1");
    expect(exports.requests.every((request) => request.url.startsWith(endpoint))).toBe(true);
  });

  it("sends unhandled rejections, including values that are not errors", async () => {
    init({ endpoint, service: "storefront" });
    reject(new Error("checkout failed", { cause: new RangeError("quantity out of range") }));
    reject({ code: 42 });

    const [error, value] = exceptions(await exports.logs());
    expect(error?.attributes["exception.mechanism"]).toBe("onunhandledrejection");
    expect(error?.attributes["exception.stacktrace"]).toContain("Caused by: RangeError: quantity out of range");
    expect(value?.attributes).toMatchObject({ "exception.message": '{"code":42}', "exception.type": "Error" });
  });

  it("adds the user, attributes, and breadcrumbs to errors", async () => {
    init({ endpoint, service: "storefront" });
    setUser({ email: "ada@example.com", id: "user-7" });
    setAttributes({ "app.plan": "pro" });
    console.warn("cart is empty");
    document.body.innerHTML = '<div id="cart"><button class="primary">Pay now</button></div>';
    document.querySelector("button")!.click();
    addBreadcrumb({ category: "checkout", message: "started payment" });
    captureException(new Error("payment declined"), { attributes: { "payment.provider": "stripe" } });

    const [error] = exceptions(await exports.logs());
    expect(error?.attributes).toMatchObject({
      "app.plan": "pro",
      "exception.handled": true,
      "exception.mechanism": "manual",
      "payment.provider": "stripe",
      "user.email": "ada@example.com",
      "user.id": "user-7",
    });
    const breadcrumbs = JSON.parse(String(error?.attributes["app.breadcrumbs"]));
    expect(breadcrumbs.map((b: { category: string; message: string }) => `${b.category}: ${b.message}`)).toEqual([
      "console: cart is empty",
      'click: div#cart > button.primary "Pay now"',
      "checkout: started payment",
    ]);
  });

  it("drops browser noise, ignored errors, and extension errors", async () => {
    init({ endpoint, ignoreErrors: [/^AbortError/, "user cancelled"], service: "storefront" });
    raise("Script error.");
    raise(new Error("ResizeObserver loop completed with undelivered notifications."));
    raise(new DOMException("The user aborted a request.", "AbortError"));
    captureException(new Error("payment user cancelled"));
    const extension = new Error("injected");
    extension.stack = "Error: injected\n    at run (chrome-extension://abcdefgh/content.js:1:2)";
    raise(extension);
    raise(new Error("real failure"));

    expect(exceptions(await exports.logs()).map((log) => log.attributes["exception.message"])).toEqual(["real failure"]);
  });

  it("lets beforeSend change or drop an error", async () => {
    init({
      beforeSend: (event) => (event.message.includes("secret") ? null : { ...event, message: event.message.toUpperCase() }),
      endpoint,
      service: "storefront",
    });
    captureException(new Error("secret token leaked"));
    captureException(new Error("quiet"));

    expect(exceptions(await exports.logs()).map((log) => log.attributes["exception.message"])).toEqual(["QUIET"]);
  });

  it("sends an error repeated at once only once, and limits errors per minute", async () => {
    init({ endpoint, maxErrorsPerMinute: 3, service: "storefront" });
    const error = new Error("render loop");
    for (let i = 0; i < 5; i += 1) captureException(error);
    for (let i = 0; i < 5; i += 1) captureException(new Error(`distinct ${i}`));

    expect(exceptions(await exports.logs()).map((log) => log.attributes["exception.message"])).toEqual([
      "render loop",
      "distinct 0",
      "distinct 1",
    ]);
  });

  it("sends messages at their level", async () => {
    init({ endpoint, service: "storefront" });
    captureMessage("checkout took longer than 5s", "warning", { "checkout.step": "payment" });

    const [log] = await exports.logs();
    expect(log).toMatchObject({ attributes: { "checkout.step": "payment" }, body: "checkout took longer than 5s", severityNumber: 13 });
  });

  it("writes trace context with the configured propagators, to the same origin only", async () => {
    const seen: Record<string, string | null> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(endpoint)) seen[url] = new Headers(init?.headers).get("x-trace");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    init({
      endpoint,
      propagators: [{
        extract: (context) => context,
        fields: () => ["x-trace"],
        inject: (_context, carrier, setter) => setter.set(carrier, "x-trace", "yes"),
      }],
      service: "storefront",
    });
    await fetch(`${location.origin}/api/cart`);
    await fetch("https://third-party.example.com/pixel");

    expect(seen).toEqual({ [`${location.origin}/api/cart`]: "yes", "https://third-party.example.com/pixel": null });
  });

  it("does not trace or record ignored requests", async () => {
    init({ endpoint, ignoreUrls: [/^https:\/\/analytics\.example\.com/], service: "storefront" });
    await fetch(`${location.origin}/api/cart`).catch(() => null);
    await fetch("https://analytics.example.com/collect").catch(() => null);
    captureException(new Error("after requests"));

    const urls = (await exports.spans()).map((span) => span.attributes["url.full"]);
    expect(urls).toContain(`${location.origin}/api/cart`);
    expect(urls).not.toContain("https://analytics.example.com/collect");
    const [error] = exceptions(await exports.logs());
    expect(String(error?.attributes["app.breadcrumbs"])).not.toContain("analytics.example.com");
  });

  it("does nothing when disabled", async () => {
    expect(init({ disabled: true, endpoint, service: "storefront" })).toBeNull();
    captureException(new Error("ignored"));
    expect(exports.requests).toEqual([]);
  });
});

describe("debug IDs", () => {
  afterEach(async () => {
    await shutdown();
    vi.unstubAllGlobals();
    globalThis.__superlogDebugIds = undefined;
  });

  it("sends the debug ID of each file in the stack", async () => {
    const exports = captureExports();
    globalThis.__superlogDebugIds = {
      "Error\n    at https://app.example.com/assets/index-B9xK3d2a.js:6:4000": "0b9f6b9e-2f4a-4c1e-9d2b-3f8a6c1d7e01",
      "@https://app.example.com/assets/vendor-Cq7xP1aa.js:1:900": "5c3e1f0a-8b7d-4e6c-a1f2-9d8e7c6b5a40",
    };
    init({ endpoint, service: "storefront" });
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at bp (https://app.example.com/assets/index-B9xK3d2a.js:6:3277)",
      "    at c (https://app.example.com/assets/vendor-Cq7xP1aa.js:1:20)",
      "    at d (https://cdn.example.com/other.js:1:1)",
    ].join("\n");
    captureException(error);

    const [sent] = exceptions(await exports.logs());
    expect(JSON.parse(String(sent?.attributes["app.debug_ids"]))).toEqual({
      "https://app.example.com/assets/index-B9xK3d2a.js": "0b9f6b9e-2f4a-4c1e-9d2b-3f8a6c1d7e01",
      "https://app.example.com/assets/vendor-Cq7xP1aa.js": "5c3e1f0a-8b7d-4e6c-a1f2-9d8e7c6b5a40",
    });
  });
});
