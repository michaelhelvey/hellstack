import { type TUnsafe, Type } from "typebox";

/**
 * Makes a string enum schema, `{ type: "string", enum: [...] }`, that all providers accept. It is
 * the same as `StringEnum` from `@earendil-works/pi-ai`, but its type is a TypeBox schema. The
 * published pi-ai types give a pi-schema `Schema`, so TypeBox `Static` cannot read it.
 */
export function StringEnum<const T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}
