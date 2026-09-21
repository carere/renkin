/** Declarative class lifecycle supported by Cloudflare's current Worker upload endpoint. */
export type DurableObjectExport =
  | { readonly type: "durable-object"; readonly storage: "sqlite"; readonly state?: "created" }
  | { readonly type: "durable-object"; readonly state: "deleted" }
  | {
      readonly type: "durable-object";
      readonly state: "renamed";
      readonly renamed_to: string;
    };
export type DurableObjectExports = Readonly<Record<string, DurableObjectExport>>;
