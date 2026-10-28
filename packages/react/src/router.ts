import { addBreadcrumb, setAttributes } from "@superlog/browser";

interface RouteMatch {
  route: { path?: string };
}

interface RouterState {
  location: { pathname: string };
  matches: RouteMatch[];
}

// A React Router data router, from createBrowserRouter or createHashRouter.
export interface DataRouter {
  state: RouterState;
  subscribe(listener: (state: RouterState) => void): () => void;
}

// The route pattern, such as `/orders/:orderId`, from the matched routes.
export function routeTemplate(matches: RouteMatch[]): string | undefined {
  const segments = matches.map((match) => match.route.path).filter((path): path is string => Boolean(path));
  if (segments.length === 0) return undefined;
  const joined = segments.reduce((template, path) => (path.startsWith("/") ? path : `${template.replace(/\/$/, "")}/${path}`), "");
  return joined.replace(/\/{2,}/g, "/") || "/";
}

// Adds the current route pattern to every log and span as `url.template`,
// so errors group and filter by route rather than by URL.
export function instrumentRouter(router: DataRouter): () => void {
  let current: string | undefined;
  const update = (state: RouterState) => {
    const template = routeTemplate(state.matches);
    if (template === current) return;
    current = template;
    setAttributes({ "url.template": template });
    if (template) addBreadcrumb({ category: "navigation", data: { path: state.location.pathname }, message: template });
  };
  update(router.state);
  return router.subscribe(update);
}
