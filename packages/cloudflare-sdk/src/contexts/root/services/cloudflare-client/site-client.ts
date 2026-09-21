import * as Workers from "@distilled.cloud/cloudflare/workers";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

export type DestinationInput = Omit<Workers.CreateObservabilityDestinationRequest, "accountId">;
export const createSiteClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const { read, write } = createOperationClient(config, gateway);
  const accountId = config.accountId;
  return {
    listDomains: (hostname: string) => read(Workers.listDomains({ accountId, hostname })),
    getDomain: (domainId: string) => read(Workers.getDomain({ accountId, domainId })),
    putDomain: (input: Omit<Workers.PutDomainRequest, "accountId">, token: string) =>
      write(Workers.putDomain({ ...input, accountId }), token),
    deleteDomain: (domainId: string, token: string) =>
      write(Workers.deleteDomain({ accountId, domainId }), token),
    listDestinations: (page = 1) =>
      read(Workers.listObservabilityDestinations({ accountId, page, perPage: 50 })),
    createDestination: (input: DestinationInput, token: string) =>
      write(Workers.createObservabilityDestination({ ...input, accountId }), token),
    updateDestination: (
      slug: string,
      input: Omit<Workers.PatchObservabilityDestinationRequest, "accountId" | "slug">,
      token: string,
    ) => write(Workers.patchObservabilityDestination({ ...input, accountId, slug }), token),
    deleteDestination: (slug: string, token: string) =>
      write(Workers.deleteObservabilityDestination({ accountId, slug }), token),
    createAssetSession: (
      scriptName: string,
      manifest: Workers.CreateScriptAssetUploadRequest["manifest"],
      token: string,
    ) => write(Workers.createScriptAssetUpload({ accountId, scriptName, manifest }), token),
    uploadAssets: (
      body: NonNullable<Workers.CreateAssetUploadRequest["body"]>,
      jwt: string,
      token: string,
    ) =>
      write(
        Workers.createAssetUpload({ accountId, base64: true, body, jwtToken: `Bearer ${jwt}` }),
        token,
      ),
    patchWorkerSettings: (scriptName: string, settings: unknown, token: string) =>
      write(Workers.patchScriptScriptAndVersionSetting({ accountId, scriptName, settings }), token),
    getWorkerSettings: (scriptName: string) =>
      read(Workers.getScriptScriptAndVersionSetting({ accountId, scriptName })),
    getWorkerSubdomain: (scriptName: string) =>
      read(Workers.getScriptSubdomain({ accountId, scriptName })),
    setWorkerSubdomain: (scriptName: string, enabled: boolean, token: string) =>
      write(
        Workers.createScriptSubdomain({ accountId, scriptName, enabled, previewsEnabled: false }),
        token,
      ),
  };
};
