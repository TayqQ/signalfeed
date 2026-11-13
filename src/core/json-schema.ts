import { z } from "zod";

// OpenAI strict structured outputs need every property listed in `required`
// and `additionalProperties: false` on every object. Zod's JSON Schema output
// is close, so this pass fills in the rest.

type JsonObject = { [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictNode);
  if (!isJsonObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    if ((key === "properties" || key === "$defs") && isJsonObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, strictNode(child)]),
      );
    } else {
      out[key] = strictNode(value);
    }
  }

  if (out.type === "object") {
    const properties = isJsonObject(out.properties) ? out.properties : {};
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

/** JSON Schema for any Zod schema, shaped for OpenAI strict mode. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strictNode(z.toJSONSchema(schema)) as Record<string, unknown>;
}
