export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const invalidArgument = () =>
  new S3Error(400, "InvalidArgument", "Invalid presigned request parameters.");
export const unsupported = () =>
  new S3Error(501, "NotImplemented", "The requested operation is not implemented.");
export const errorResponse = (error: unknown, head: boolean): Response => {
  const failure =
    error instanceof S3Error
      ? error
      : new S3Error(500, "InternalError", "The request could not be completed.");
  return new Response(
    head
      ? null
      : `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${failure.code}</Code><Message>${failure.message}</Message></Error>`,
    {
      status: failure.status,
      headers: { "content-type": "application/xml" },
    },
  );
};
