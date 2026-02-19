// The registry to map old variable IDs to newly created IDs
const idMap = new Map<string, string>();

async function migrateVariables(
  sourceCollectionId: string,
  targetCollectionId: string,
) {
  const sourceCol =
    await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
  const targetCol =
    await figma.variables.getVariableCollectionByIdAsync(targetCollectionId);

  if (!sourceCol || !targetCol) {
    figma.notify("Error: Source or Target collection not found.", {
      error: true,
    });
    return;
  }

  // --- PASS 1: CREATE STRUCTURE & PRESERVE SCOPES ---
  // Iterate through source variable IDs and create new variables in the target
  for (const sourceId of sourceCol.variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    if (!sourceVar) continue;

    const newVar = figma.variables.createVariable(
      sourceVar.name,
      targetCol, // Must pass collection object, not just ID
      sourceVar.resolvedType,
    );

    // Sync metadata base properties
    newVar.description = sourceVar.description;
    newVar.scopes = sourceVar.scopes; // Preserve scoping (e.g., ALL_FILLS, TEXT_CONTENT)

    idMap.set(sourceVar.id, newVar.id);
  }

  // --- PASS 2: ASSIGN VALUES & RESOLVE ALIASES ---
  for (const sourceId of sourceCol.variableIds) {
    const sourceVar = await figma.variables.getVariableByIdAsync(sourceId);
    const newVarId = idMap.get(sourceId);
    const newVar = await figma.variables.getVariableByIdAsync(newVarId!);
    if (!sourceVar || !newVar) continue;

    sourceCol.modes.forEach((sourceMode, index) => {
      const sourceValue = sourceVar.valuesByMode[sourceMode.modeId];

      // Mode Matching: Match by index or default to the first target mode
      const targetModeId =
        targetCol.modes[index]?.modeId || targetCol.modes[0].modeId;

      // Type Handling: Check for VariableAlias vs Raw Value
      if (isVariableAlias(sourceValue)) {
        // Resolve alias using the idMap or fallback to original if external
        const mappedId = idMap.get(sourceValue.id) || sourceValue.id;
        newVar.setValueForMode(targetModeId, {
          type: "VARIABLE_ALIAS",
          id: mappedId,
        });
      } else {
        newVar.setValueForMode(targetModeId, sourceValue);
      }
    });
  }

  // --- GLOBAL RE-BINDING ---
  // Find nodes and swap bound variables globally
  const allNodes = figma.currentPage.findAll();
  allNodes.forEach((node) => {
    if ("boundVariables" in node && node.boundVariables) {
      const currentBounds = node.boundVariables;

      // Example: Swap Fills
      if (currentBounds.fills) {
        const updatedFills = currentBounds.fills.map((alias) => ({
          type: "VARIABLE_ALIAS" as const,
          id: idMap.get(alias.id) || alias.id,
        }));
        // Note: For array-based properties like fills, use specific setters if required
        // exampleNode.setBoundVariable("fills", updatedFills[0])
      }

      // Example: Swap Strokes
      if (currentBounds.strokes) {
        // Apply similar mapping logic
      }
    }
  });

  figma.notify("Migration complete!");
}

function isVariableAlias(value: any): value is VariableAlias {
  return value && value.type === "VARIABLE_ALIAS";
}

figma.showUI(__html__, { width: 500, height: 600, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "GET_DATA") {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
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

  if (msg.type === "RUN_MIGRATION") {
    try {
      await migrateVariables(
        msg.payload.sourceCollectionId,
        msg.payload.targetCollectionId,
      );
      figma.ui.postMessage({ type: "MIGRATION_SUCCESS" });
    } catch (err) {
      figma.notify("Migration failed: " + err, { error: true });
      figma.ui.postMessage({ type: "MIGRATION_ERROR" });
    }
  }
};
