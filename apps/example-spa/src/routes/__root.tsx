import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/solid-router";
import { HydrationScript } from "solid-js/web";
export const Route = createRootRoute({ component: Root });
function Root() {
  return (
    <html lang="en">
      <head>
        <HydrationScript />
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
      </head>
      <body>
        <header>
          <nav aria-label="Main">
            <Link to="/">Home</Link> <Link to="/details">Details</Link>
          </nav>
        </header>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
