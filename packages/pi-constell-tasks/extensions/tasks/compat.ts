export class Text {
  constructor(
    public readonly text: string,
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export const Type = {
  Object(properties: Record<string, unknown>) {
    return { type: 'object', properties }
  },
  String(options: Record<string, unknown> = {}) {
    return { type: 'string', ...options }
  },
  Optional(schema: unknown) {
    return schema
  },
  Record(_key: unknown, value: unknown, options: Record<string, unknown> = {}) {
    return { type: 'object', additionalProperties: value, ...options }
  },
  Unknown() {
    return {}
  },
  Array(items: unknown, options: Record<string, unknown> = {}) {
    return { type: 'array', items, ...options }
  },
  Union(anyOf: unknown[]) {
    return { anyOf }
  },
  Literal(value: string) {
    return { const: value }
  },
  Null() {
    return { type: 'null' }
  },
  Number(options: Record<string, unknown> = {}) {
    return { type: 'number', ...options }
  },
  Boolean(options: Record<string, unknown> = {}) {
    return { type: 'boolean', ...options }
  },
}
