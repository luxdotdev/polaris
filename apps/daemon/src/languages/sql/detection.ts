import { basename, dirname } from "node:path";
import { LanguageSqlDialect, type LanguageSqlDialectState } from "@polaris/protocol";
import { Schema } from "effect";
import { ancestors, nearest, readText } from "../discovery/files.ts";

type Detected = Pick<typeof LanguageSqlDialectState.Type, "dialect" | "source">;

export function dialectHint(text: string, path: string): Detected | null {
  const hint = /^\s*--\s*polaris-sql-dialect:\s*(\w+)\s*$/im.exec(text.slice(0, 4096));

  if (hint !== null && Schema.is(LanguageSqlDialect)(hint[1]))
    return { dialect: hint[1], source: "hint" };
  const filename = /\.(postgresql|postgres|mysql|sqlite)\.sql$/i.exec(basename(path));

  if (filename === null) return null;
  const value = filename[1]!.toLowerCase();

  const dialect = Schema.decodeUnknownSync(LanguageSqlDialect)(
    value === "postgres" ? "postgresql" : value
  );

  return { dialect, source: "filename" };
}

export async function detectDialect(root: string, path: string): Promise<Detected> {
  const hint = dialectHint(await readText(path), path);

  if (hint !== null) return hint;

  const prisma = await nearest(root, ancestors(root, dirname(path)), [
    "prisma/schema.prisma",
    "schema.prisma",
  ]);

  if (prisma !== null) {
    const text = (await readText(prisma.path))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    const providers = [
      ...text.matchAll(
        /datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"(postgresql|mysql|sqlite)"[^}]*\}/g
      ),
    ];

    const unique = new Set(providers.map((match) => match[1]));

    if (unique.size === 1)
      return {
        dialect: Schema.decodeUnknownSync(LanguageSqlDialect)(providers[0]![1]),
        source: "prisma",
      };
  }

  return { dialect: "generic", source: "default" };
}
