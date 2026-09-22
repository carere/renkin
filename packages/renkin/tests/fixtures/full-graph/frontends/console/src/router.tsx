import { createRouter } from "@tanstack/solid-router";
import { createGraphContext } from "#test-fixtures/full-graph/frontends/shared/context.ts";
import { routeTree } from "./routeTree.gen";
export const getRouter = () => createRouter({ routeTree, context: createGraphContext() });
