import { setAttributes, addBreadcrumb } from "@superlog/browser/api";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { createRoutesFromChildren, matchRoutes, Routes, useLocation } from "react-router";
import { routeTemplate } from "./router.js";

export interface SuperlogRoutesProps {
  children?: ReactNode;
  location?: Parameters<typeof Routes>[0]["location"];
}

// A drop-in for React Router's `<Routes>` that adds the matched route
// pattern to every log and span as `url.template`. For data routers, use
// `instrumentRouter` instead.
export function SuperlogRoutes({ children, location }: SuperlogRoutesProps) {
  const current = useLocation();
  const routes = useMemo(() => createRoutesFromChildren(children), [children]);
  const pathname = typeof location === "string" ? location : (location?.pathname ?? current.pathname);
  const template = useMemo(() => routeTemplate(matchRoutes(routes, pathname) ?? []), [routes, pathname]);

  // Set while rendering, since the matched route's effects run before this
  // component's and their errors need the new pattern. Setting it again is
  // harmless if React discards the render.
  const applied = useRef<string | undefined>(undefined);
  if (applied.current !== template) {
    applied.current = template;
    setAttributes({ "url.template": template });
  }

  useEffect(() => {
    if (template) addBreadcrumb({ category: "navigation", data: { path: pathname }, message: template });
  }, [template, pathname]);

  return <Routes location={location}>{children}</Routes>;
}
