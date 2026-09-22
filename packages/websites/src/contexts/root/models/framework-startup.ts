export type FrameworkStartupStage =
  | "load-tanstack-development"
  | "invoke-tanstack-development"
  | "prepare-tanstack-directory"
  | "create-vite-server"
  | "listen-vite-server"
  | "create-forwarding-build"
  | "wrap-framework-build"
  | "close-framework-session";

class FrameworkStartupError extends Error {
  constructor(
    readonly stage: FrameworkStartupStage,
    cause: unknown,
  ) {
    super("Framework development startup failed.", { cause });
  }
}

/** Keep a fixed internal stage; the public boundary sanitizes the original cause. */
export const frameworkStartup = async <T>(
  stage: FrameworkStartupStage,
  action: () => Promise<T>,
): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    throw error instanceof FrameworkStartupError ? error : new FrameworkStartupError(stage, error);
  }
};
