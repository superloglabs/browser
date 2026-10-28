import { captureExports, exceptions } from "../../browser/src/test-support.js";
import { captureException, init, shutdown } from "@superlog/browser";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, instrumentRouter, reactErrorHandler, routeTemplate } from "./index.js";

const endpoint = "https://intake.example.com";

function Checkout(): never {
  throw new Error("cart total is undefined");
}

describe("@superlog/react", () => {
  let exports: ReturnType<typeof captureExports>;

  beforeEach(() => {
    exports = captureExports();
    init({ endpoint, instrumentations: { console: false }, service: "storefront" });
  });

  afterEach(async () => {
    await shutdown();
    vi.unstubAllGlobals();
  });

  it("sends render errors with the component stack and shows the fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={({ error }) => <p>Failed: {(error as Error).message}</p>}>
        <Checkout />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Failed: cart total is undefined")).toBeTruthy();
    const sent = exceptions(await exports.logs());
    const fromBoundary = sent.filter((log) => log.attributes["exception.mechanism"] === "react");
    expect(fromBoundary).toHaveLength(1);
    expect(fromBoundary[0]?.attributes["exception.message"]).toBe("cart total is undefined");
    expect(fromBoundary[0]?.attributes["react.component_stack"]).toMatch(/Checkout/);
  });

  it("reports root errors from React 19's root options", async () => {
    const callback = vi.fn();
    reactErrorHandler(callback)(new Error("hydration failed"), { componentStack: "\n    at App" });

    const [error] = exceptions(await exports.logs());
    expect(error?.attributes).toMatchObject({ "exception.message": "hydration failed", "react.component_stack": "\n    at App" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("adds the route pattern to errors after each navigation", async () => {
    const router = createMemoryRouter(
      [{ children: [{ element: null, path: "orders/:orderId" }, { element: null, path: "settings" }], element: null, path: "/" }],
      { initialEntries: ["/orders/41"] },
    );
    const stop = instrumentRouter(router);
    captureException(new Error("order failed"));
    await router.navigate("/settings");
    captureException(new Error("settings failed"));
    stop();

    const templates = exceptions(await exports.logs()).map((log) => log.attributes["url.template"]);
    expect(templates).toEqual(["/orders/:orderId", "/settings"]);
  });

  it("builds route patterns from nested and absolute paths", () => {
    expect(routeTemplate([{ route: { path: "/" } }, { route: {} }, { route: { path: "teams/:teamId" } }, { route: { path: "members" } }]))
      .toBe("/teams/:teamId/members");
    expect(routeTemplate([{ route: { path: "/app" } }, { route: { path: "/admin/*" } }])).toBe("/admin/*");
    expect(routeTemplate([])).toBeUndefined();
  });
});
