import type { ResourceDefinition } from "@renkin/core/models/stack";
import {
  type MigrationFile,
  readMigrationFiles,
} from "#src/contexts/root/services/migrations/migration-files.ts";

export const prepareD1 = async (resource: ResourceDefinition): Promise<ResourceDefinition> => {
  if (resource.type !== "cloudflare.d1") return resource;
  const properties = resource.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties))
    throw new Error("Invalid D1 properties.");
  const path = "migrations" in properties ? properties.migrations : null;
  if (path !== null && typeof path !== "string") throw new Error("Invalid migration directory.");
  const migrations = path === null ? [] : await readMigrationFiles(path);
  return {
    ...resource,
    properties: {
      ...properties,
      migrationFiles: migrations.map(({ name, sql, hash }) => ({ name, sql, hash })),
    },
  };
};

export const preparedMigrations = (resource: ResourceDefinition): readonly MigrationFile[] => {
  const properties = resource.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties) ||
    !("migrationFiles" in properties) ||
    !Array.isArray(properties.migrationFiles)
  )
    throw new Error("D1 migrations must be prepared before deployment.");
  return properties.migrationFiles.map((file) => {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      !("name" in file) ||
      typeof file.name !== "string" ||
      typeof file.sql !== "string" ||
      typeof file.hash !== "string"
    )
      throw new Error("Invalid prepared migration.");
    return { name: file.name, sql: file.sql, hash: file.hash, bytes: Buffer.from(file.sql) };
  });
};
