// The registry to map old variable IDs to newly created IDs
const idMap = new Map<string, string>();

async function migrateVariables(
  sourceCollectionId: string,
  targetCollectionId: string,
  variableIds: string[],
) {
  const sourceCol =
    await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
  const targetCol =
    await figma.variables.getVariableCollectionByIdAsync(targetCollectionId);

  if (!sourceCol || !targetCol) {
    throw new Error("Source or Target collection not found.");
  }

  // --- PASS 1: CREATE STRUCTURE & PRESERVE SCOPES ---
  for (const sourceId of variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    if (!sourceVar) continue;

    const newVar = figma.variables.createVariable(
      sourceVar.name,
      targetCol,
      sourceVar.resolvedType,
    );

    newVar.description = sourceVar.description;
    newVar.scopes = sourceVar.scopes;

    idMap.set(sourceVar.id, newVar.id);
  }

  // --- PASS 2: ASSIGN VALUES & RESOLVE ALIASES ---
  for (const sourceId of variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    const newVarId = idMap.get(sourceId);
    if (!sourceVar || !newVarId) continue;

    const newVar = await figma.variables.getVariableByIdAsync(newVarId);
    if (!newVar) continue;

    sourceCol.modes.forEach((sourceMode, index) => {
      const sourceValue = sourceVar.valuesByMode[sourceMode.modeId];
      const targetMode =
        targetCol.modes.find((m) => m.name === sourceMode.name) ||
        targetCol.modes[index] ||
        targetCol.modes[0];

      if (isVariableAlias(sourceValue)) {
        const mappedId = idMap.get(sourceValue.id) || sourceValue.id;
        newVar.setValueForMode(targetMode.modeId, {
          type: "VARIABLE_ALIAS",
          id: mappedId,
        });
      } else {
        newVar.setValueForMode(targetMode.modeId, sourceValue);
      }
    });
  }

  // --- GLOBAL RE-BINDING ---
  const allNodes = figma.currentPage.findAll();
  for (const node of allNodes) {
    if ("boundVariables" in node && node.boundVariables) {
      const currentBounds = node.boundVariables;

      if (currentBounds.fills) {
        const newFills = currentBounds.fills.map((alias) => ({
          type: "VARIABLE_ALIAS" as const,
          id: idMap.get(alias.id) || alias.id,
        }));
        // @ts-ignore
        node.setBoundVariable("fills", newFills[0]);
      }

      if (currentBounds.strokes) {
        const newStrokes = currentBounds.strokes.map((alias) => ({
          type: "VARIABLE_ALIAS" as const,
          id: idMap.get(alias.id) || alias.id,
        }));
        // @ts-ignore
        node.setBoundVariable("strokes", newStrokes[0]);
      }

      const props = [
        "opacity",
        "visible",
        "cornerRadius",
        "itemSpacing",
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
      ];
      for (const prop of props) {
        if (currentBounds[prop]) {
          const alias = currentBounds[prop];
          if (idMap.has(alias.id)) {
            // @ts-ignore
            node.setBoundVariable(prop, idMap.get(alias.id));
          }
        }
      }
    }
  }

  // --- PASS 3: DELETE ORIGINAL VARIABLES ---
  for (const sourceId of variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    if (sourceVar) {
      sourceVar.remove();
    }
  }

  figma.notify(`Successfully moved ${variableIds.length} variables.`);
}

function isVariableAlias(value: any): value is VariableAlias {
  return value && value.type === "VARIABLE_ALIAS";
}

figma.showUI(__html__, { width: 500, height: 600, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "GET_DATA") {
    const collections =
      await figma.variables.getLocalVariableCollectionsAsync();
    const data = collections.map((col) => ({
      id: col.id,
      name: col.name,
      variableIds: col.variableIds,
    }));
    figma.ui.postMessage({ type: "DATA_LOADED", payload: data });
  }

  if (msg.type === "GET_VARIABLES") {
    const col = await figma.variables.getVariableCollectionByIdAsync(
      msg.payload.collectionId,
    );
    if (col) {
      const vars = await Promise.all(
        col.variableIds.map(async (id) => {
          const v = await figma.variables.getVariableByIdAsync(id);
          return { id: v!.id, name: v!.name, resolvedType: v!.resolvedType };
        }),
      );
      figma.ui.postMessage({ type: "VARIABLES_LOADED", payload: vars });
    }
  }

  if (msg.type === "RESIZE_WINDOW") {
    figma.ui.resize(msg.payload.width, msg.payload.height);
    // Optional: Persist size for next time
    figma.clientStorage.setAsync("plugin-size", msg.payload);
  }

  if (msg.type === "RUN_MIGRATION") {
    try {
      await migrateVariables(
        msg.payload.sourceCollectionId,
        msg.payload.targetCollectionId,
        msg.payload.variableIds,
      );
      figma.ui.postMessage({ type: "MIGRATION_SUCCESS" });
    } catch (err) {
      figma.notify("Migration failed: " + err, { error: true });
      figma.ui.postMessage({ type: "MIGRATION_ERROR" });
    }
  }
};
