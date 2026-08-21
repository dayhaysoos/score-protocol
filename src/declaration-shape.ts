import { parseSync } from "oxc-parser";

type PrimitiveType = "string" | "number" | "boolean" | "void";

type ParameterCandidate = {
  readonly name: string;
  readonly optional: boolean;
  readonly rest: boolean;
  readonly annotation: unknown;
};

type TypeLeaf =
  | { readonly kind: "primitive"; readonly name: PrimitiveType }
  | { readonly kind: "reference"; readonly name: string };

type TypeAnnotation =
  | TypeLeaf
  | { readonly kind: "union"; readonly types: ReadonlyArray<TypeLeaf> };

type Result =
  | {
      readonly status: "ok";
      readonly shape:
        | {
            readonly kind: "function";
            readonly name: string;
            readonly async: false;
            readonly generator: false;
            readonly typeParameters: readonly [];
            readonly params: ReadonlyArray<{
              readonly name: string;
              readonly optional: boolean;
              readonly rest: boolean;
              readonly typeAnnotation: PrimitiveType;
            }>;
            readonly returnType: PrimitiveType;
          }
        | {
            readonly kind: "type";
            readonly name: string;
            readonly typeParameters: readonly [];
            readonly typeAnnotation: TypeAnnotation;
          }
        | {
            readonly kind: "interface";
            readonly name: string;
            readonly typeParameters: readonly [];
            readonly extends: readonly [];
            readonly members: ReadonlyArray<{
              readonly kind: "property";
              readonly name: string;
              readonly optional: boolean;
              readonly readonly: boolean;
              readonly typeAnnotation: TypeAnnotation;
            }>;
          };
    }
  | {
      readonly status: "invalid";
      readonly finding: {
        readonly code:
          | "DECLARATION_SYNTAX_INVALID"
          | "DECLARATION_SHAPE_UNSUPPORTED"
          | "DECLARATION_CONTRACT_INCOMPLETE";
        readonly message: string;
      };
    };

function invalid(
  code:
    | "DECLARATION_SYNTAX_INVALID"
    | "DECLARATION_SHAPE_UNSUPPORTED"
    | "DECLARATION_CONTRACT_INCOMPLETE",
  message: string
): Result {
  return { status: "invalid", finding: { code, message } };
}

function unsupported(): Result {
  return invalid(
    "DECLARATION_SHAPE_UNSUPPORTED",
    "Expected exactly one supported exported declaration."
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function parameterCandidate(value: unknown): ParameterCandidate | undefined {
  const parameter = asRecord(value);
  if (parameter === undefined) return undefined;

  if (parameter.type === "RestElement") {
    const argument = asRecord(parameter.argument);
    if (argument?.type !== "Identifier" || typeof argument.name !== "string") {
      return undefined;
    }
    return {
      name: argument.name,
      optional: argument.optional === true,
      rest: true,
      annotation: parameter.typeAnnotation
    };
  }

  if (parameter.type !== "Identifier" || typeof parameter.name !== "string") {
    return undefined;
  }
  return {
    name: parameter.name,
    optional: parameter.optional === true,
    rest: false,
    annotation: parameter.typeAnnotation
  };
}

function primitiveType(annotation: unknown): PrimitiveType | undefined {
  const wrapper = asRecord(annotation);
  const type = asRecord(wrapper?.typeAnnotation);
  switch (type?.type) {
    case "TSStringKeyword":
      return "string";
    case "TSNumberKeyword":
      return "number";
    case "TSBooleanKeyword":
      return "boolean";
    case "TSVoidKeyword":
      return "void";
    default:
      return undefined;
  }
}

function aliasLeaf(annotation: unknown): TypeLeaf | undefined {
  const type = asRecord(annotation);
  switch (type?.type) {
    case "TSStringKeyword":
      return { kind: "primitive", name: "string" };
    case "TSNumberKeyword":
      return { kind: "primitive", name: "number" };
    case "TSBooleanKeyword":
      return { kind: "primitive", name: "boolean" };
    case "TSVoidKeyword":
      return { kind: "primitive", name: "void" };
    case "TSTypeReference": {
      const typeName = asRecord(type.typeName);
      if (
        typeName?.type !== "Identifier" ||
        typeof typeName.name !== "string" ||
        type.typeArguments !== null
      ) {
        return undefined;
      }
      return { kind: "reference", name: typeName.name };
    }
    default:
      return undefined;
  }
}

function normalizedTypeAnnotation(annotation: unknown): TypeAnnotation | undefined {
  const directLeaf = aliasLeaf(annotation);
  if (directLeaf !== undefined) return directLeaf;

  const type = asRecord(annotation);
  if (type?.type !== "TSUnionType" || !Array.isArray(type.types)) {
    return undefined;
  }
  const types: TypeLeaf[] = [];
  for (const member of type.types) {
    const leaf = aliasLeaf(member);
    if (leaf === undefined) return undefined;
    types.push(leaf);
  }
  return { kind: "union", types };
}

export function normalizeDeclarationShape(declaration: string): Result {
  let parsed: ReturnType<typeof parseSync>;
  try {
    parsed = parseSync("declaration.ts", declaration, {
      lang: "ts",
      sourceType: "module",
      astType: "ts"
    });
  } catch {
    return invalid(
      "DECLARATION_SYNTAX_INVALID",
      "The declaration is not valid TypeScript syntax."
    );
  }

  if (parsed.errors.length > 0) {
    return invalid(
      "DECLARATION_SYNTAX_INVALID",
      "The declaration is not valid TypeScript syntax."
    );
  }

  const program = asRecord(parsed.program);
  const body = program?.body;
  if (!Array.isArray(body) || body.length !== 1) return unsupported();

  const exported = asRecord(body[0]);
  const exportedDeclaration = asRecord(exported?.declaration);
  if (
    exported?.type !== "ExportNamedDeclaration" ||
    exported.source !== null ||
    !Array.isArray(exported.specifiers) ||
    exported.specifiers.length !== 0 ||
    exportedDeclaration === undefined
  ) {
    return unsupported();
  }

  if (exportedDeclaration.type === "FunctionDeclaration") {
    if (
      exportedDeclaration.declare === true ||
      exportedDeclaration.async === true ||
      exportedDeclaration.generator === true ||
      (exportedDeclaration.typeParameters !== null &&
        exportedDeclaration.typeParameters !== undefined)
    ) {
      return unsupported();
    }

    const id = asRecord(exportedDeclaration.id);
    const parameters = exportedDeclaration.params;
    if (
      id?.type !== "Identifier" ||
      typeof id.name !== "string" ||
      !Array.isArray(parameters)
    ) {
      return unsupported();
    }

    const candidates: ParameterCandidate[] = [];
    for (const parameter of parameters) {
      const candidate = parameterCandidate(parameter);
      if (candidate === undefined) return unsupported();
      candidates.push(candidate);
    }

    if (
      exportedDeclaration.returnType === null ||
      exportedDeclaration.returnType === undefined ||
      candidates.some(
        (candidate) => candidate.annotation === null || candidate.annotation === undefined
      )
    ) {
      return invalid(
        "DECLARATION_CONTRACT_INCOMPLETE",
        "Every parameter and the return value must have an explicit supported type."
      );
    }

    const params: Array<{
      readonly name: string;
      readonly optional: boolean;
      readonly rest: boolean;
      readonly typeAnnotation: PrimitiveType;
    }> = [];
    for (const candidate of candidates) {
      const typeAnnotation = primitiveType(candidate.annotation);
      if (typeAnnotation === undefined) return unsupported();
      params.push({
        name: candidate.name,
        optional: candidate.optional,
        rest: candidate.rest,
        typeAnnotation
      });
    }

    const returnType = primitiveType(exportedDeclaration.returnType);
    if (returnType === undefined) return unsupported();

    return {
      status: "ok",
      shape: {
        kind: "function",
        name: id.name,
        async: false,
        generator: false,
        typeParameters: [],
        params,
        returnType
      }
    };
  }

  if (exportedDeclaration.type === "TSTypeAliasDeclaration") {
    const id = asRecord(exportedDeclaration.id);
    if (
      id?.type !== "Identifier" ||
      typeof id.name !== "string" ||
      (exportedDeclaration.typeParameters !== null &&
        exportedDeclaration.typeParameters !== undefined)
    ) {
      return unsupported();
    }

    const typeAnnotation = normalizedTypeAnnotation(exportedDeclaration.typeAnnotation);
    if (typeAnnotation === undefined) return unsupported();
    return {
      status: "ok",
      shape: { kind: "type", name: id.name, typeParameters: [], typeAnnotation }
    };
  }

  if (exportedDeclaration.type !== "TSInterfaceDeclaration") return unsupported();

  const id = asRecord(exportedDeclaration.id);
  const interfaceBody = asRecord(exportedDeclaration.body);
  if (
    id?.type !== "Identifier" ||
    typeof id.name !== "string" ||
    (exportedDeclaration.typeParameters !== null &&
      exportedDeclaration.typeParameters !== undefined) ||
    !Array.isArray(exportedDeclaration.extends) ||
    exportedDeclaration.extends.length !== 0 ||
    interfaceBody?.type !== "TSInterfaceBody" ||
    !Array.isArray(interfaceBody.body)
  ) {
    return unsupported();
  }

  const members: Array<{
    readonly kind: "property";
    readonly name: string;
    readonly optional: boolean;
    readonly readonly: boolean;
    readonly typeAnnotation: TypeAnnotation;
  }> = [];
  for (const value of interfaceBody.body) {
    const member = asRecord(value);
    const key = asRecord(member?.key);
    if (
      member?.type !== "TSPropertySignature" ||
      member.computed !== false ||
      key?.type !== "Identifier" ||
      typeof key.name !== "string" ||
      member.static !== false ||
      member.accessibility !== null
    ) {
      return unsupported();
    }
    if (member.typeAnnotation === null || member.typeAnnotation === undefined) {
      return invalid(
        "DECLARATION_CONTRACT_INCOMPLETE",
        "Every interface property must have an explicit supported type."
      );
    }
    const typeAnnotation = normalizedTypeAnnotation(
      asRecord(member.typeAnnotation)?.typeAnnotation
    );
    if (typeAnnotation === undefined) return unsupported();
    members.push({
      kind: "property",
      name: key.name,
      optional: member.optional === true,
      readonly: member.readonly === true,
      typeAnnotation
    });
  }

  return {
    status: "ok",
    shape: {
      kind: "interface",
      name: id.name,
      typeParameters: [],
      extends: [],
      members
    }
  };
}
