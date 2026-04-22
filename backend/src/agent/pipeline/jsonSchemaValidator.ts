/**
 * Minimal JSON Schema validator used by `outputFormat: 'json'` agents.
 *
 * Supports a strict subset of JSON Schema: `type`, `items`, `required`, `properties`,
 * `enum`. Anything else in the schema is ignored. This is intentionally tiny so we
 * don't pull in a full Ajv dependency for what amounts to "the LLM returned the
 * shape we asked for".
 */

/** A single validation error: human-readable, path-prefixed. */
export interface ValidationError {
    /** JSON path to the offending location, e.g. `root.items[2].priority`. */
    path: string;
    /** Human-readable failure message. */
    message: string;
}

/** Result of running `validateAgainstSchema`. */
export interface ValidationResult {
    /** True iff the value matched the schema. */
    valid: boolean;
    /** All errors discovered (empty when `valid` is true). */
    errors: ValidationError[];
}

/**
 * Validate `value` against the supplied minimal JSON Schema.
 *
 * - When `schema` is `undefined` or empty, validation passes unconditionally.
 * - All errors are collected; validation never throws.
 */
export function validateAgainstSchema(value: unknown, schema: object | undefined): ValidationResult {
    /** Accumulator for discovered errors. */
    const errors: ValidationError[] = [];

    // No schema provided → caller opted out; nothing to validate.
    if (!schema || Object.keys(schema).length === 0) {
        return { valid: true, errors };
    }

    // Recurse into the value with the schema.
    validateNode(value, schema as SchemaNode, 'root', errors);

    return { valid: errors.length === 0, errors };
}

/** Internal: shape of a schema node we accept. */
interface SchemaNode {
    /** Expected JSON type. */
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
    /** Schema for items when `type === 'array'`. */
    items?: SchemaNode;
    /** Required property names when `type === 'object'`. */
    required?: string[];
    /** Property schemas when `type === 'object'`. */
    properties?: Record<string, SchemaNode>;
    /** Allowed primitive values. */
    enum?: unknown[];
}

/** Recursively validate `value` against `node`, appending errors to `errors`. */
function validateNode(value: unknown, node: SchemaNode, path: string, errors: ValidationError[]): void {
    // Type check
    if (node.type) {
        // Determine the actual JSON type of `value`.
        const actual: string = jsonTypeOf(value);
        // For 'integer', accept only numbers without a fractional part.
        if (node.type === 'integer') {
            if (typeof value !== 'number' || !Number.isInteger(value)) {
                errors.push({ path, message: `expected integer, got ${actual}` });
                return;
            }
        } else if (actual !== node.type) {
            errors.push({ path, message: `expected ${node.type}, got ${actual}` });
            return;
        }
    }

    // Enum check
    if (node.enum && Array.isArray(node.enum)) {
        // Compare with strict equality; suitable for primitives.
        if (!node.enum.some(allowed => allowed === value)) {
            errors.push({ path, message: `value ${JSON.stringify(value)} not in enum [${node.enum.map(v => JSON.stringify(v)).join(', ')}]` });
        }
    }

    // Array items
    if (node.type === 'array' && Array.isArray(value) && node.items) {
        // Validate every element against the items schema.
        for (let i = 0; i < value.length; i++) {
            validateNode(value[i], node.items, `${path}[${i}]`, errors);
        }
    }

    // Object properties + required
    if (node.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
        // Cast for property access.
        const obj: Record<string, unknown> = value as Record<string, unknown>;
        // Required fields present?
        if (node.required) {
            for (const key of node.required) {
                if (!(key in obj)) {
                    errors.push({ path: `${path}.${key}`, message: 'missing required property' });
                }
            }
        }
        // Recurse into property schemas.
        if (node.properties) {
            for (const [key, propSchema] of Object.entries(node.properties)) {
                if (key in obj) {
                    validateNode(obj[key], propSchema, `${path}.${key}`, errors);
                }
            }
        }
    }
}

/** Map a JS value to the JSON Schema type string. */
function jsonTypeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    const t: string = typeof value;
    if (t === 'object') return 'object';
    if (t === 'number') return 'number';
    if (t === 'string') return 'string';
    if (t === 'boolean') return 'boolean';
    return t;
}

/**
 * Extract the first JSON value (object or array) from a raw LLM response.
 * Strips common markdown code-fence wrappers. Returns `undefined` if no JSON
 * could be parsed.
 */
export function extractFirstJson(raw: string): unknown | undefined {
    if (!raw) return undefined;
    /** Trimmed input. */
    const trimmed: string = raw.trim();
    // First, try direct parse — succeeds when the whole response is JSON.
    try {
        return JSON.parse(trimmed);
    } catch {
        // Fall through to fence/regex extraction.
    }
    // Strip ```json … ``` fences if present.
    const fenceMatch: RegExpMatchArray | null = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
        try {
            return JSON.parse(fenceMatch[1]);
        } catch {
            // Fall through.
        }
    }
    // Greedy match for first top-level array or object.
    const arrayMatch: RegExpMatchArray | null = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            return JSON.parse(arrayMatch[0]);
        } catch {
            // Fall through.
        }
    }
    const objectMatch: RegExpMatchArray | null = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch {
            // Fall through.
        }
    }
    return undefined;
}
