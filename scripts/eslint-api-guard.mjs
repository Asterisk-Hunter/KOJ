const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export const apiGuardRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: { unguarded: "Export HTTP handlers through withApiGuard so authorization and shared rate limits cannot be omitted." },
  },
  create(context) {
    return {
      ExportAllDeclaration(node) {
        context.report({ node, messageId: "unguarded" });
      },
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;
        if (declaration?.type === "FunctionDeclaration" && methods.has(declaration.id?.name)) {
          context.report({ node, messageId: "unguarded" });
        }
        if (declaration?.type === "VariableDeclaration") {
          for (const variable of declaration.declarations) {
            if (variable.id.type !== "Identifier" || !methods.has(variable.id.name)) continue;
            if (variable.init?.type !== "CallExpression" || variable.init.callee.type !== "Identifier" || variable.init.callee.name !== "withApiGuard") {
              context.report({ node: variable, messageId: "unguarded" });
            }
          }
        }
        for (const specifier of node.specifiers) {
          if (methods.has(specifier.exported.name)) context.report({ node: specifier, messageId: "unguarded" });
        }
      },
    };
  },
};
