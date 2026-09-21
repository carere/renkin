import { createRouter } from "@tanstack/solid-router";
import { createGraphContext } from "../../shared/context.ts";
import { routeTree } from "./routeTree.gen";
export const getRouter = () => createRouter({ routeTree, context: createGraphContext() });
