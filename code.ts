// ─────────────────────────────────────────────────────────────────────────────
// Variable Migration Plugin – code.ts
// ─────────────────────────────────────────────────────────────────────────────

const idMap = new Map<string, string>();

// ─── ID normalisation ─────────────────────────────────────────────────────────
// Figma is inconsistent: variable IDs sometimes come as "VariableID:123:456"
// and sometimes as "123:456" depending on which API surface returns them.
// We store every mapping under both forms so lookups never miss.

function normalise(id: string): string {
  const raw = id.startsWith("VariableID:") ? id.slice("VariableID:".length) : id;
  return `VariableID:${raw}`;
}

function raw(id: string): string {
  return id.startsWith("VariableID:") ? id.slice("VariableID:".length) : id;
}

function registerMapping(oldId: string, newId: string) {
  idMap.set(normalise(oldId), normalise(newId));
  idMap.set(raw(oldId), normalise(newId));
}

function resolveMappedId(oldId: string): string | undefined {
  return idMap.get(normalise(oldId)) ?? idMap.get(raw(oldId));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isVariableAlias(value: unknown): value is VariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).type === "VARIABLE_ALIAS"
  );
}

async function getVariable(
  id: string,
  cache: Map<string, Variable>
): Promise<Variable | null> {
  const normId = normalise(id);
  if (cache.has(normId)) return cache.get(normId)!;
  const v = await figma.variables.getVariableByIdAsync(normId);
  if (v) cache.set(normId, v);
  return v ?? null;
}

// ─── Paint rebinding (fills / strokes) ───────────────────────────────────────
// boundVariables[field] is a SPARSE OBJECT — keys are paint array indices as
// strings. Use Object.entries() to get real indices; never iterate 0..length.

async function rebindPaints(
  node: SceneNode,
  field: "fills" | "strokes",
  varCache: Map<string, Variable>
): Promise<boolean> {
  if (!(field in node)) return false;

  const paints = (node as any)[field] as Paint[];
  if (!Array.isArray(paints) || paints.length === 0) return false;

  const bounds = (node as any).boundVariables?.[field];
  if (!bounds || typeof bounds !== "object") return false;

  const entries = Object.entries(bounds) as [string, VariableAlias][];
  if (entries.length === 0) return false;

  let changed = false;
  const updatedPaints = [...paints];

  for (const [indexStr, alias] of entries) {
    if (!alias || alias.type !== "VARIABLE_ALIAS") continue;

    const newId = resolveMappedId(alias.id);
    if (!newId) continue;

    const newVar = await getVariable(newId, varCache);
    if (!newVar) continue;

    const paintIndex = parseInt(indexStr, 10);
    const paint = updatedPaints[paintIndex];
    if (!paint || paint.type !== "SOLID") continue;

    try {
      updatedPaints[paintIndex] = figma.variables.setBoundVariableForPaint(
        paint,
        "color",
        newVar as unknown as Variable
      );
      changed = true;
    } catch (e) {
      console.error(`[rebind] setBoundVariableForPaint failed on "${node.name}" ${field}[${paintIndex}]:`, e);
    }
  }

  if (changed) {
    try {
      (node as any)[field] = updatedPaints;
    } catch (e) {
      console.error(`[rebind] Could not write ${field} back to "${node.name}":`, e);
      return false;
    }
  }

  return changed;
}

// ─── Single-value prop rebinding ──────────────────────────────────────────────

const SINGLE_PROPS = [
  "opacity", "visible", "cornerRadius",
  "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius",
  "itemSpacing", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
  "fontFamily", "fontSize", "fontStyle", "fontWeight",
  "letterSpacing", "lineHeight", "paragraphIndent", "paragraphSpacing",
] as const;

async function rebindSingleProps(
  node: SceneNode,
  varCache: Map<string, Variable>
): Promise<boolean> {
  if (!("boundVariables" in node) || !node.boundVariables) return false;
  if (!("setBoundVariable" in node)) return false;

  const bounds = node.boundVariables as any;
  let changed = false;

  for (const prop of SINGLE_PROPS) {
    const alias: VariableAlias | undefined = bounds[prop];
    if (!alias || alias.type !== "VARIABLE_ALIAS") continue;

    const newId = resolveMappedId(alias.id);
    if (!newId) continue;

    const newVar = await getVariable(newId, varCache);
    if (!newVar) continue;

    try {
      (node as any).setBoundVariable(prop, newVar);
      changed = true;
    } catch (e) {
      console.error(`[rebind] setBoundVariable(${prop}) failed on "${node.name}":`, e);
    }
  }

  return changed;
}

// ─── Text node rebinding ──────────────────────────────────────────────────────

async function rebindTextNode(
  node: TextNode,
  varCache: Map<string, Variable>
): Promise<boolean> {
  let changed = false;

  try {
    const segments = node.getStyledTextSegments(["boundVariables"]);

    for (const segment of segments) {
      if (!segment.boundVariables) continue;

      for (const field of ["fills", "strokes"] as const) {
        const aliases = (segment.boundVariables as any)[field];
        if (!aliases || typeof aliases !== "object") continue;

        const entries = Object.entries(aliases) as [string, VariableAlias][];

        for (const [indexStr, alias] of entries) {
          if (!alias || alias.type !== "VARIABLE_ALIAS") continue;

          const newId = resolveMappedId(alias.id);
          if (!newId) continue;

          const newVar = await getVariable(newId, varCache);
          if (!newVar) continue;

          const paintIndex = parseInt(indexStr, 10);

          try {
            (node as any).setRangeBoundVariableForPaint(
              segment.start,
              segment.end,
              field,
              paintIndex,
              newVar
            );
            changed = true;
          } catch (e) {
            console.error(`[rebind] setRangeBoundVariableForPaint failed on "${node.name}":`, e);
          }
        }
      }
    }
  } catch (e) {
    console.error(`[rebind] Text segment iteration failed on "${node.name}":`, e);
  }

  return changed;
}

// ─── Instance component property rebinding ───────────────────────────────────

async function rebindInstanceProps(
  node: InstanceNode,
  varCache: Map<string, Variable>
): Promise<boolean> {
  if (!node.componentProperties) return false;

  let changed = false;

  for (const propName in node.componentProperties) {
    const prop = node.componentProperties[propName];
    if (!prop.boundVariables) continue;

    for (const boundAttr in prop.boundVariables) {
      const alias = (prop.boundVariables as any)[boundAttr] as VariableAlias;
      if (!alias || alias.type !== "VARIABLE_ALIAS") continue;

      const newId = resolveMappedId(alias.id);
      if (!newId) continue;

      const newVar = await getVariable(newId, varCache);
      if (!newVar) continue;

      try {
        node.setProperties({
          [propName]: { type: "VARIABLE_ALIAS", id: newVar.id } as any,
        });
        changed = true;
      } catch (e) {
        console.error(`[rebind] Instance property "${propName}" failed on "${node.name}":`, e);
      }
    }
  }

  return changed;
}

// ─── Paint style rebinding ────────────────────────────────────────────────────

async function rebindPaintStyle(
  style: PaintStyle,
  varCache: Map<string, Variable>
): Promise<boolean> {
  if (!("boundVariables" in style) || !style.boundVariables) return false;

  const bounds = (style.boundVariables as any).paints;
  if (!bounds || typeof bounds !== "object") return false;

  const entries = Object.entries(bounds) as [string, VariableAlias][];
  if (entries.length === 0) return false;

  let changed = false;
  const updatedPaints = [...style.paints];

  for (const [indexStr, alias] of entries) {
    if (!alias || alias.type !== "VARIABLE_ALIAS") continue;

    const newId = resolveMappedId(alias.id);
    if (!newId) continue;

    const newVar = await getVariable(newId, varCache);
    if (!newVar) continue;

    const paintIndex = parseInt(indexStr, 10);
    const paint = updatedPaints[paintIndex];
    if (!paint || paint.type !== "SOLID") continue;

    try {
      updatedPaints[paintIndex] = figma.variables.setBoundVariableForPaint(
        paint,
        "color",
        newVar as unknown as Variable
      );
      changed = true;
    } catch (e) {
      console.error(`[rebind] Style paint failed on "${style.name}":`, e);
    }
  }

  if (changed) {
    try {
      style.paints = updatedPaints;
    } catch (e) {
      console.error(`[rebind] Could not write paints back to style "${style.name}":`, e);
      return false;
    }
  }

  return changed;
}

// ─── Main rebind pass ─────────────────────────────────────────────────────────

async function rebindAll(): Promise<{ nodesUpdated: number; stylesUpdated: number }> {
  const varCache = new Map<string, Variable>();
  let nodesUpdated = 0;
  let stylesUpdated = 0;

  const allNodes = figma.root.findAll().filter((n): n is SceneNode => n.type !== "PAGE");

  for (const node of allNodes) {
    let nodeChanged = false;

    if (node.type === "TEXT") {
      if (await rebindTextNode(node, varCache)) nodeChanged = true;
    }
    if (await rebindPaints(node, "fills", varCache)) nodeChanged = true;
    if (await rebindPaints(node, "strokes", varCache)) nodeChanged = true;
    if (await rebindSingleProps(node, varCache)) nodeChanged = true;
    if (node.type === "INSTANCE") {
      if (await rebindInstanceProps(node, varCache)) nodeChanged = true;
    }

    if (nodeChanged) nodesUpdated++;
  }

  const paintStyles = await figma.getLocalPaintStylesAsync();
  for (const style of paintStyles) {
    if (await rebindPaintStyle(style, varCache)) stylesUpdated++;
  }

  return { nodesUpdated, stylesUpdated };
}

// ─── Migration ────────────────────────────────────────────────────────────────

async function migrateVariables(
  sourceCollectionId: string,
  targetCollectionId: string,
  variableIds: string[]
): Promise<void> {
  const sourceCol = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
  const targetCol = await figma.variables.getVariableCollectionByIdAsync(targetCollectionId);

  if (!sourceCol || !targetCol) {
    throw new Error("Source or Target collection not found.");
  }

  idMap.clear();

  // Pass 1: Create new variables in the target collection
  for (const sourceId of variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    if (!sourceVar) continue;

    const newVar = figma.variables.createVariable(
      sourceVar.name,
      targetCol,
      sourceVar.resolvedType
    );
    newVar.description = sourceVar.description;
    newVar.scopes = sourceVar.scopes;

    try {
      if ((sourceVar as any).codeSyntax) {
        (newVar as any).codeSyntax = (sourceVar as any).codeSyntax;
      }
    } catch (_) {}

    registerMapping(sourceVar.id, newVar.id);
  }

  // Pass 2: Copy values; remap any alias targets that were also migrated
  for (const sourceId of variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    const newVarId = resolveMappedId(sourceId);
    if (!sourceVar || !newVarId) continue;

    const newVar = await figma.variables.getVariableByIdAsync(newVarId);
    if (!newVar) continue;

    for (let modeIndex = 0; modeIndex < sourceCol.modes.length; modeIndex++) {
      const sourceMode = sourceCol.modes[modeIndex];
      const sourceValue = sourceVar.valuesByMode[sourceMode.modeId];

      const targetMode =
        targetCol.modes.find((m) => m.name === sourceMode.name) ??
        targetCol.modes[modeIndex] ??
        targetCol.modes[0];

      if (!targetMode) continue;

      if (isVariableAlias(sourceValue)) {
        const resolvedAliasId = resolveMappedId(sourceValue.id) ?? sourceValue.id;
        newVar.setValueForMode(targetMode.modeId, {
          type: "VARIABLE_ALIAS",
          id: resolvedAliasId,
        });
      } else {
        newVar.setValueForMode(targetMode.modeId, sourceValue);
      }
    }
  }

  // Pass 3: Rebind all nodes and styles to the new variable IDs
  const { nodesUpdated, stylesUpdated } = await rebindAll();

  // Pass 4: Delete the original source variables
  for (const sourceId of variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    if (sourceVar) sourceVar.remove();
  }

  figma.notify(
    `Done! Moved ${variableIds.length} variable(s). Updated ${nodesUpdated} nodes, ${stylesUpdated} styles.`
  );
}

// ─── Plugin lifecycle ─────────────────────────────────────────────────────────

figma.on("run", async () => {
  const savedSize = await figma.clientStorage.getAsync("plugin-size");
  figma.showUI(__html__, {
    width: savedSize?.width ?? 500,
    height: savedSize?.height ?? 600,
    themeColors: true,
  });
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === "GET_DATA") {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    figma.ui.postMessage({
      type: "DATA_LOADED",
      payload: collections.map((col) => ({
        id: col.id,
        name: col.name,
        variableIds: col.variableIds,
      })),
    });
  }

  if (msg.type === "GET_VARIABLES") {
    const col = await figma.variables.getVariableCollectionByIdAsync(
      msg.payload.collectionId
    );
    if (col) {
      const firstModeId = col.modes[0]?.modeId;
      const vars = await Promise.all(
        col.variableIds.map(async (id) => {
          const v = await figma.variables.getVariableByIdAsync(id);
          if (!v) return null;
          let previewValue: { kind: string; [key: string]: unknown } | undefined;
          if (firstModeId !== undefined) {
            const raw = v.valuesByMode[firstModeId];
            if (isVariableAlias(raw)) {
              const aliasVar = await figma.variables.getVariableByIdAsync(raw.id);
              previewValue = { kind: "alias", name: aliasVar ? aliasVar.name : raw.id };
            } else if (v.resolvedType === "COLOR" && raw && typeof raw === "object") {
              const c = raw as { r: number; g: number; b: number };
              const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
              previewValue = { kind: "color", hex: `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}` };
            } else if (v.resolvedType === "FLOAT" && typeof raw === "number") {
              previewValue = { kind: "float", value: raw };
            } else if (v.resolvedType === "BOOLEAN" && typeof raw === "boolean") {
              previewValue = { kind: "boolean", value: raw };
            } else if (v.resolvedType === "STRING" && typeof raw === "string") {
              previewValue = { kind: "string", value: raw };
            }
          }
          return { id: v.id, name: v.name, resolvedType: v.resolvedType, previewValue };
        })
      );
      figma.ui.postMessage({
        type: "VARIABLES_LOADED",
        payload: vars.filter(Boolean),
      });
    }
  }

  if (msg.type === "RUN_MIGRATION") {
    try {
      await migrateVariables(
        msg.payload.sourceCollectionId,
        msg.payload.targetCollectionId,
        msg.payload.variableIds
      );
      figma.ui.postMessage({ type: "MIGRATION_SUCCESS" });
    } catch (err: any) {
      figma.notify("Migration failed: " + err.message, { error: true });
      figma.ui.postMessage({ type: "MIGRATION_ERROR" });
    }
  }

  if (msg.type === "RESIZE_WINDOW") {
    figma.ui.resize(msg.payload.width, msg.payload.height);
    figma.clientStorage.setAsync("plugin-size", msg.payload);
  }
};
