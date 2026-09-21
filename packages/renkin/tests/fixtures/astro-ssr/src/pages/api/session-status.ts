import type { APIRoute } from "astro";
export const GET: APIRoute = ({ session }) => Response.json({ enabled: session !== undefined });
