#!/usr/bin/env python3
"""A small hand-written validator for data/*.json against data/*.schema.json.

Not JSON Schema. A dialect small enough to read in one sitting, enough for the
nextbook data files:

  type                  "object" | "array" | "string" | "integer" | "number"
                        | "boolean" | "null", or a list of those
  required              list of keys that must be present
  properties            per-key schema
  additionalProperties  false, or a schema for keys not in `properties`
  items                 schema for every array item
  enum                  list of allowed values
  minimum / minItems / maxItems
  x-forbiddenKeys       keys that must not appear (the blurb ban, AGENTS.md 4)

A file's schema is its own name with `.schema.json`: data/slice.json is checked
by data/slice.schema.json.

    python3 adapters/validate.py data/slice.json data/tags.json data/practice.json
"""

import json
import os
import sys

FORBIDDEN_ANYWHERE = ("description", "jacket")

TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "null": type(None),
}


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def schema_path_for(json_path):
    base = os.path.basename(json_path)
    if base.endswith(".json"):
        base = base[: -len(".json")]
    return os.path.join(os.path.dirname(os.path.abspath(json_path)), base + ".schema.json")


def type_matches(value, name):
    expected = TYPES[name]
    if name in ("integer", "number") and isinstance(value, bool):
        return False
    return isinstance(value, expected)


def type_name(value):
    for name, python_type in TYPES.items():
        if name in ("integer", "number") and isinstance(value, bool):
            continue
        if isinstance(value, python_type):
            return name
    return type(value).__name__


def validate(value, schema, path="$"):
    """Return a list of plain-language errors. Empty means valid."""
    errors = []
    where = path or "$"

    if "type" in schema:
        names = schema["type"]
        names = [names] if isinstance(names, str) else list(names)
        if not any(type_matches(value, name) for name in names):
            errors.append("%s: expected %s, found %s"
                          % (where, " or ".join(names), type_name(value)))
            return errors

    if "enum" in schema and value not in schema["enum"]:
        errors.append("%s: %r is not one of %s" % (where, value, schema["enum"]))

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append("%s: shorter than %d characters" % (where, schema["minLength"]))

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append("%s: %r is below the minimum %r" % (where, value, schema["minimum"]))

    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append("%s: missing required key %r" % (where, key))
        for key in schema.get("x-forbiddenKeys", []):
            if key in value:
                errors.append("%s: key %r is not allowed here (AGENTS.md rule 4: never store it)"
                              % (where, key))
        for key in value:
            if key in FORBIDDEN_ANYWHERE and key not in schema.get("x-forbiddenKeys", []):
                errors.append("%s: key %r is not allowed anywhere (AGENTS.md rule 4)" % (where, key))
        properties = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for key, child in value.items():
            child_path = "%s.%s" % (path, key) if path != "$" else "$." + key
            if key in properties:
                errors.extend(validate(child, properties[key], child_path))
            elif extra is False:
                errors.append("%s: unexpected key %r" % (where, key))
            elif isinstance(extra, dict):
                errors.extend(validate(child, extra, child_path))

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append("%s: has %d items, needs at least %d"
                          % (where, len(value), schema["minItems"]))
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append("%s: has %d items, allows at most %d"
                          % (where, len(value), schema["maxItems"]))
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                errors.extend(validate(item, item_schema, "%s[%d]" % (path, index)))

    return errors


def validate_document(doc, schema):
    return validate(doc, schema, "$")


def validate_file(json_path):
    """Validate one data file against its sibling schema. Returns (errors, doc)."""
    schema_file = schema_path_for(json_path)
    if not os.path.exists(schema_file):
        return ["%s: no schema at %s" % (json_path, schema_file)], None
    try:
        doc = load(json_path)
    except (OSError, ValueError) as error:
        return ["%s: cannot read: %s" % (json_path, error)], None
    try:
        schema = load(schema_file)
    except (OSError, ValueError) as error:
        return ["%s: cannot read schema %s: %s" % (schema_file, schema_file, error)], doc
    return validate_document(doc, schema), doc


def summarise(path, doc):
    if not isinstance(doc, dict):
        return ""
    for key in ("works", "entries"):
        if isinstance(doc.get(key), list):
            return "%d %s" % (len(doc[key]), key)
        if isinstance(doc.get(key), dict):
            return "%d %s" % (len(doc[key]), key)
    return ""


def main(argv):
    if not argv:
        print("usage: python3 adapters/validate.py data/slice.json [...]", file=sys.stderr)
        return 2
    failed = 0
    for path in argv:
        errors, doc = validate_file(path)
        if errors:
            failed += 1
            print("FAIL %s" % path)
            for error in errors:
                print("  " + error)
        else:
            summary = summarise(path, doc)
            print("OK   %s%s" % (path, " (%s)" % summary if summary else ""))
    if failed:
        print("%d of %d files failed" % (failed, len(argv)))
        return 1
    print("all %d files valid" % len(argv))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
