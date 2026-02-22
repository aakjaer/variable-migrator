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

// Follow an alias chain until we reach a concrete COLOR value, then return
// its hex string. Returns undefined for non-color or unresolvable aliases.
// preferredModeId is tried first; falls back to first available mode so that
// cross-collection aliases (different mode IDs) still resolve correctly.
async function resolveAliasColor(
  varId: string,
  preferredModeId: string,
  depth = 0,
): Promise<string | undefined> {
  if (depth > 10) return undefined;
  const v = await figma.variables.getVariableByIdAsync(varId);
  if (!v || v.resolvedType !== "COLOR") return undefined;

  const val =
    v.valuesByMode[preferredModeId] ??
    Object.values(v.valuesByMode)[0];
  if (!val) return undefined;

  if (isVariableAlias(val)) {
    return resolveAliasColor(val.id, preferredModeId, depth + 1);
  }

  if (typeof val === "object" && "r" in val) {
    const c = val as { r: number; g: number; b: number };
    const toHex = (n: number) =>
      Math.round(n * 255).toString(16).padStart(2, "0");
    return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
  }
  return undefined;
}

function isVariableAlias(value: unknown): value is VariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).type === "VARIABLE_ALIAS"
  );
}

function getVariable(
  id: string,
  cache: Map<string, Variable>
): Variable | null {
  const normId = normalise(id);
  if (cache.has(normId)) return cache.get(normId)!;
  const v = figma.variables.getVariableById(normId);
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

    const newVar = getVariable(newId, varCache);
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

    const newVar = getVariable(newId, varCache);
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

          const newVar = getVariable(newId, varCache);
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

      const newVar = getVariable(newId, varCache);
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

    const newVar = getVariable(newId, varCache);
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

// Returns true if any VariableAlias found inside `bv` has an id that is in
// `sourceIdSet`. Works for both flat alias maps (fills/strokes paint-index
// records) and direct alias values (opacity, cornerRadius, etc.).
function hasRelevantAlias(bv: unknown, sourceIdSet: Set<string>): boolean {
  if (!bv || typeof bv !== "object") return false;
  for (const val of Object.values(bv as object)) {
    if (!val || typeof val !== "object") continue;
    const v = val as any;
    if (v.type === "VARIABLE_ALIAS") {
      if (sourceIdSet.has(v.id)) return true;
    } else {
      // Paint-index map: { "0": VariableAlias, "1": VariableAlias, … }
      for (const inner of Object.values(v)) {
        if (
          inner &&
          typeof inner === "object" &&
          (inner as any).type === "VARIABLE_ALIAS" &&
          sourceIdSet.has((inner as any).id)
        ) return true;
      }
    }
  }
  return false;
}

async function rebindAll(
  varCache: Map<string, Variable>,
  onScan: (topLevelFrames: number, pages: number) => void,
  onProgress: (done: number, total: number) => void,
): Promise<{ nodesUpdated: number; stylesUpdated: number }> {
  let nodesUpdated = 0;
  let stylesUpdated = 0;

  // Cheap size estimate: count top-level children across all pages.
  // This requires no deep traversal and gives the UI a rough scale signal
  // before findAll blocks the main thread.
  const pages = figma.root.children.length;
  const topLevelFrames = figma.root.children.reduce(
    (n, page) => n + (page as PageNode).children.length, 0
  );
  onScan(topLevelFrames, pages);
  // Yield so the scanning message is delivered and rendered before findAll
  // freezes the main thread.
  await new Promise<void>(resolve => setTimeout(resolve, 0));

  // Build a set of every source variable ID being migrated (both normalised
  // and raw forms, since nodes can store either). This lets us skip the vast
  // majority of nodes in large files — only nodes whose boundVariables
  // actually reference one of our migrated IDs are included.
  const sourceIdSet = new Set<string>(idMap.keys());

  // NOTE: getStyledTextSegments is intentionally excluded from this predicate.
  // Calling it for every TEXT node inside a synchronous findAll is very slow
  // and extends Figma's unresponsive period. TEXT nodes are included
  // unconditionally here; the rebindTextNode call in the loop below handles
  // the segment-level check and skips nodes with no relevant bindings cheaply.
  const allNodes = figma.root.findAll((n) => {
    if (n.type === "PAGE") return false;

    // Check top-level boundVariables (covers most node types).
    const bv = (n as any).boundVariables;
    if (bv && typeof bv === "object" && hasRelevantAlias(bv, sourceIdSet)) return true;

    // Include all TEXT nodes — segment bindings are checked in the loop.
    if (n.type === "TEXT") return true;

    // INSTANCE: variable bindings can live in componentProperties, not in
    // the top-level boundVariables object.
    if (n.type === "INSTANCE") {
      try {
        const props = (n as InstanceNode).componentProperties;
        if (props) {
          for (const prop of Object.values(props)) {
            if (hasRelevantAlias((prop as any).boundVariables, sourceIdSet)) return true;
          }
        }
      } catch { return false; }
    }

    return false;
  }) as SceneNode[];

  const total = allNodes.length;
  let done = 0;

  // Announce the actual total so the progress bar can show 0 / N immediately.
  onProgress(0, total);
  await new Promise<void>(resolve => setTimeout(resolve, 0));

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

    done++;
    if (done % 10 === 0 || done === total) {
      onProgress(done, total);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  const paintStyles = await figma.getLocalPaintStylesAsync();
  for (const style of paintStyles) {
    if (await rebindPaintStyle(style, varCache)) stylesUpdated++;
  }

  return { nodesUpdated, stylesUpdated };
}

// ─── Migration ────────────────────────────────────────────────────────────────

interface MigrationResult {
  movedCount: number;
  replacedCount: number;
  nodesUpdated: number;
  stylesUpdated: number;
}

async function migrateVariables(
  sourceCollectionId: string,
  targetCollectionId: string,
  variableIds: string[],
  replaceConflicts: boolean,
): Promise<MigrationResult> {
  const sourceCol = figma.variables.getVariableCollectionById(sourceCollectionId);
  const targetCol = figma.variables.getVariableCollectionById(targetCollectionId);

  if (!sourceCol || !targetCol) {
    throw new Error("Source or Target collection not found.");
  }

  idMap.clear();

  // Pass 1: Create new variables in the target collection.
  // When replaceConflicts is true, variables whose name already exists in the
  // target are mapped to the existing variable instead of creating a duplicate.
  // Pass 2 then overwrites that variable's values from the source.
  let movedCount = 0;
  let replacedCount = 0;

  // Pre-index target variables by name so conflict lookup is O(1).
  const targetVarsByName = new Map<string, Variable>();
  if (replaceConflicts) {
    for (const id of targetCol.variableIds) {
      const tv = figma.variables.getVariableById(id);
      if (tv) targetVarsByName.set(tv.name, tv);
    }
  }

  for (const sourceId of variableIds) {
    const sourceVar = figma.variables.getVariableById(sourceId);
    if (!sourceVar) continue;

    if (replaceConflicts) {
      const existing = targetVarsByName.get(sourceVar.name);
      if (existing) {
        // Map source → existing target; Pass 2 will overwrite its values.
        registerMapping(sourceVar.id, existing.id);
        movedCount++;
        replacedCount++;
        continue;
      }
    }

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
    movedCount++;
  }

  // Pass 2: Copy values; remap any alias targets that were also migrated.
  // Iterate over TARGET modes so every mode gets a value, even if the source
  // collection has fewer modes. Matching priority:
  //   1. Exact mode name match
  //   2. Same positional index
  //   3. First source mode (fallback)
  for (const sourceId of variableIds) {
    const sourceVar = figma.variables.getVariableById(sourceId);
    const newVarId = resolveMappedId(sourceId);
    if (!sourceVar || !newVarId) continue;

    const newVar = figma.variables.getVariableById(newVarId);
    if (!newVar) continue;

    for (let targetModeIndex = 0; targetModeIndex < targetCol.modes.length; targetModeIndex++) {
      const targetMode = targetCol.modes[targetModeIndex];

      const sourceMode =
        sourceCol.modes.find((m) => m.name === targetMode.name) ??
        sourceCol.modes[targetModeIndex] ??
        sourceCol.modes[0];

      if (!sourceMode) continue;

      const sourceValue = sourceVar.valuesByMode[sourceMode.modeId];
      if (sourceValue === undefined) continue;

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

  // Pass 3: Rebind alias values in ALL variables across ALL collections.
  // Scene-node rebinding (Pass 4) handles node/style references, but other
  // variables (e.g. Theme/color/brand aliasing Core/brand/600) also hold
  // VariableAlias values that must be updated before the source is deleted.
  // getLocalVariables() is synchronous and returns every variable in one call —
  // no per-variable async round-trips needed.
  const allVariables = figma.variables.getLocalVariables();

  for (const variable of allVariables) {
    for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
      if (isVariableAlias(value)) {
        const newId = resolveMappedId(value.id);
        if (newId) {
          variable.setValueForMode(modeId, { type: "VARIABLE_ALIAS", id: newId });
        }
      }
    }
  }

  // Pass 4: Rebind all nodes and styles to the new variable IDs.
  // Pre-warm the variable cache with all newly created variables so
  // the inner loop hits memory instead of making async API calls per node.
  const varCache = new Map<string, Variable>();
  for (const newId of new Set(idMap.values())) {
    const v = figma.variables.getVariableById(newId);
    if (v) {
      varCache.set(normalise(newId), v);
      varCache.set(raw(newId), v);
    }
  }

  const { nodesUpdated, stylesUpdated } = await rebindAll(
    varCache,
    (topLevelFrames: number, pages: number) => {
      figma.ui.postMessage({ type: "MIGRATION_SCANNING", payload: { topLevelFrames, pages } });
    },
    (done: number, total: number) => {
      figma.ui.postMessage({ type: "MIGRATION_PROGRESS", payload: { done, total } });
    },
  );

  // Pass 5: Delete the original source variables
  for (const sourceId of variableIds) {
    const sourceVar = figma.variables.getVariableById(sourceId);
    if (sourceVar) sourceVar.remove();
  }

  const skipped = variableIds.length - movedCount;
  const skippedNote = skipped > 0 ? ` (${skipped} skipped — deleted before migration)` : "";
  const replacedNote = replacedCount > 0 ? `, ${replacedCount} replaced` : "";
  figma.notify(
    `Done! Moved ${movedCount} variable(s)${replacedNote}${skippedNote}. Updated ${nodesUpdated} nodes, ${stylesUpdated} styles.`
  );

  return { movedCount, replacedCount, nodesUpdated, stylesUpdated };
}

// ─── Plugin lifecycle ─────────────────────────────────────────────────────────

// Track which collection is currently loaded in the UI so we can detect
// when its variables change behind the user's back.
let watchedCollectionId: string | null = null;
let watchedVariableCount: number | null = null;
let isMigrating = false;

figma.on("documentchange", async () => {
  if (!watchedCollectionId || isMigrating) return;
  const col = await figma.variables.getVariableCollectionByIdAsync(watchedCollectionId);
  const currentCount = col ? col.variableIds.length : null;
  if (currentCount !== watchedVariableCount) {
    watchedVariableCount = currentCount;
    figma.ui.postMessage({ type: "VARIABLES_STALE" });
  }
});

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
        modes: col.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
        variableIds: col.variableIds,
      })),
    });
  }

  if (msg.type === "GET_VARIABLES") {
    const col = await figma.variables.getVariableCollectionByIdAsync(
      msg.payload.collectionId
    );
    if (col) {
      watchedCollectionId = col.id;
      watchedVariableCount = col.variableIds.length;

      const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");

      const vars = await Promise.all(
        col.variableIds.map(async (id) => {
          const v = await figma.variables.getVariableByIdAsync(id);
          if (!v) return null;

          const previewValues: Record<string, unknown> = {};
          for (const mode of col.modes) {
            const rawVal = v.valuesByMode[mode.modeId];
            if (rawVal === undefined) continue;

            if (isVariableAlias(rawVal)) {
              const [aliasVar, resolvedColor] = await Promise.all([
                figma.variables.getVariableByIdAsync(rawVal.id),
                resolveAliasColor(rawVal.id, mode.modeId),
              ]);
              previewValues[mode.modeId] = {
                kind: "alias",
                name: aliasVar ? aliasVar.name : rawVal.id,
                resolvedColor,
              };
            } else if (v.resolvedType === "COLOR" && rawVal && typeof rawVal === "object") {
              const c = rawVal as { r: number; g: number; b: number };
              previewValues[mode.modeId] = { kind: "color", hex: `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}` };
            } else if (v.resolvedType === "FLOAT" && typeof rawVal === "number") {
              previewValues[mode.modeId] = { kind: "float", value: rawVal };
            } else if (v.resolvedType === "BOOLEAN" && typeof rawVal === "boolean") {
              previewValues[mode.modeId] = { kind: "boolean", value: rawVal };
            } else if (v.resolvedType === "STRING" && typeof rawVal === "string") {
              previewValues[mode.modeId] = { kind: "string", value: rawVal };
            }
          }

          return { id: v.id, name: v.name, resolvedType: v.resolvedType, previewValues };
        })
      );
      figma.ui.postMessage({
        type: "VARIABLES_LOADED",
        payload: vars.filter(Boolean),
      });
    }
  }

  if (msg.type === "DRY_RUN") {
    const { sourceCollectionId, targetCollectionId, variableIds } = msg.payload;
    try {
      const sourceCol = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
      const targetCol = await figma.variables.getVariableCollectionByIdAsync(targetCollectionId);

      if (!sourceCol) {
        figma.ui.postMessage({ type: "DRY_RUN_RESULT", payload: { error: "source_missing" } });
        return;
      }
      if (!targetCol) {
        figma.ui.postMessage({ type: "DRY_RUN_RESULT", payload: { error: "target_missing" } });
        return;
      }

      // Parallel fetch — sequential awaits on large collections cause visible hangs
      const [selectedVars, targetVars] = await Promise.all([
        Promise.all(variableIds.map((id: string) => figma.variables.getVariableByIdAsync(id))),
        Promise.all(targetCol.variableIds.map((id: string) => figma.variables.getVariableByIdAsync(id))),
      ]);

      const movedNames = new Set<string>();
      let missingCount = 0;
      for (const v of selectedVars) {
        if (v) movedNames.add(v.name);
        else missingCount++;
      }

      const conflictingNames = targetVars
        .filter((tv): tv is Variable => tv !== null && movedNames.has(tv.name))
        .map(tv => tv.name);

      figma.ui.postMessage({
        type: "DRY_RUN_RESULT",
        payload: { conflictingNames, missingCount },
      });
    } catch (err: any) {
      figma.ui.postMessage({ type: "DRY_RUN_RESULT", payload: { error: "failed", message: err.message } });
    }
  }

  if (msg.type === "RUN_MIGRATION") {
    isMigrating = true;
    try {
      const result = await migrateVariables(
        msg.payload.sourceCollectionId,
        msg.payload.targetCollectionId,
        msg.payload.variableIds,
        msg.payload.replaceConflicts ?? false,
      );
      figma.ui.postMessage({ type: "MIGRATION_SUCCESS", payload: result });
    } catch (err: any) {
      figma.notify("Migration failed: " + err.message, { error: true });
      figma.ui.postMessage({ type: "MIGRATION_ERROR" });
    } finally {
      isMigrating = false;
    }
  }

  if (msg.type === "RESIZE_WINDOW") {
    figma.ui.resize(msg.payload.width, msg.payload.height);
    figma.clientStorage.setAsync("plugin-size", msg.payload);
  }
};
