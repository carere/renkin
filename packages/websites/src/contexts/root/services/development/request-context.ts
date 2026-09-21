import { AsyncLocalStorage } from "node:async_hooks";

export interface WebsiteRequestContext {
  readonly bindings: Record<string, unknown>;
  readonly pending: Set<Promise<unknown>>;
  active: boolean;
}

const key = Symbol.for("renkin.website.request-context");
const registry = globalThis as typeof globalThis & {
  [key]?: AsyncLocalStorage<WebsiteRequestContext>;
};
/** Shared across Vite config and SSR module runners, with an independent store per request. */
registry[key] ??= new AsyncLocalStorage();
export const websiteRequestContext = registry[key];

export const platformModuleSource = `
const context=()=>{
  const current=globalThis[Symbol.for("renkin.website.request-context")]?.getStore();
  if(!current?.active)throw new Error("Cloudflare bindings are available only during an active request.");
  return current;
};
export const env=new Proxy({}, {
  get:(_,name)=>context().bindings[name],
  has:(_,name)=>name in context().bindings,
  ownKeys:()=>Reflect.ownKeys(context().bindings),
  getOwnPropertyDescriptor:(_,name)=>({configurable:true,enumerable:true,value:context().bindings[name]}),
});
export const waitUntil=(promise)=>{
  const current=context();
  const pending=Promise.resolve(promise);
  current.pending.add(pending);
  pending.catch(()=>{});
};
`;
