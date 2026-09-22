import { Miniflare } from "miniflare";

export interface LocalR2Removal {
  readonly physicalId: string;
  readonly forceDestroy: boolean;
}
export class LocalR2RemovalError extends Error {
  readonly name = "LocalR2RemovalError";
  constructor() {
    super(
      "R2 bucket contains objects. Explicit forceDestroy permission is required to empty it before deletion.",
    );
  }
}
/** Inspect every affected bucket before emptying any of them; never erase the shared persistence root. */
export const removeLocalR2Objects = async (
  persist: string,
  removals: readonly LocalR2Removal[],
): Promise<void> => {
  if (!removals.length) return;
  const names = removals.map((_, index) => `R2_${index}`);
  const runtime = new Miniflare({
    script: "export default {fetch(){return new Response(null,{status:404})}}",
    modules: true,
    compatibilityDate: "2026-07-30",
    defaultPersistRoot: persist,
    r2Buckets: Object.fromEntries(
      removals.map((item, index) => [names[index] ?? "", item.physicalId]),
    ),
  });
  try {
    const buckets = await Promise.all(names.map((name) => runtime.getR2Bucket(name)));
    for (const [index, bucket] of buckets.entries())
      if ((await bucket.list({ limit: 1 })).objects.length && !removals[index]?.forceDestroy)
        throw new LocalR2RemovalError();
    for (const bucket of buckets) {
      for (;;) {
        const page = await bucket.list({ limit: 1000 });
        if (!page.objects.length) break;
        await bucket.delete(page.objects.map((object) => object.key));
      }
    }
  } finally {
    await runtime.dispose();
  }
};
