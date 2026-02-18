
/**
 * FigSystem Variable Migration Core
 * This file contains the logic that runs in the Figma sandbox.
 */

// Fix: Added global declarations for Figma API and variables to resolve 'Cannot find name' errors
declare const figma: any;
declare const __html__: string;
type Variable = any;

const migrateVariables = async (
  sourceCollectionId: string,
  targetCollectionId: string,
  variableIds: string[]
) => {
  const sourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
  const targetCollection = await figma.variables.getVariableCollectionByIdAsync(targetCollectionId);

  if (!sourceCollection || !targetCollection) {
    throw new Error("Collections not found");
  }

  // Registry for mapping old variable IDs to new ones
  const idRegistry = new Map<string, string>();
  const variablesToProcess: Variable[] = [];

  // Fetch source variables
  for (const id of variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) variablesToProcess.push(v);
  }

  // --- PASS 1: Create Base Variables ---
  for (const sourceVar of variablesToProcess) {
    const newVar = figma.variables.createVariable(
      sourceVar.name,
      targetCollection.id,
      sourceVar.resolvedType
    );

    newVar.description = sourceVar.description;
    newVar.scopes = [...sourceVar.scopes]; // Preservation of scopes
    
    idRegistry.set(sourceVar.id, newVar.id);
  }

  // --- PASS 2: Assign Values and Resolve Aliases ---
  for (const sourceVar of variablesToProcess) {
    const newVarId = idRegistry.get(sourceVar.id);
    if (!newVarId) continue;
    
    const newVar = await figma.variables.getVariableByIdAsync(newVarId);
    if (!newVar) continue;

    for (const sourceModeId of Object.keys(sourceVar.valuesByMode)) {
      const sourceValue = sourceVar.valuesByMode[sourceModeId];
      
      // Mode Matching: Attempt to find mode by name, otherwise default to first
      const sourceMode = sourceCollection.modes.find((m: any) => m.modeId === sourceModeId);
      let targetModeId = targetCollection.modes[0].modeId;
      
      if (sourceMode) {
        const matchingTargetMode = targetCollection.modes.find((m: any) => m.name === sourceMode.name);
        if (matchingTargetMode) targetModeId = matchingTargetMode.modeId;
      }

      // Handle Aliases vs Raw Values
      if (typeof sourceValue === 'object' && sourceValue !== null && 'type' in sourceValue && sourceValue.type === 'VARIABLE_ALIAS') {
        // Resolve alias using registry if it's within the moved set, otherwise keep original
        const mappedId = idRegistry.get(sourceValue.id) || sourceValue.id;
        newVar.setValueForMode(targetModeId, {
          type: 'VARIABLE_ALIAS',
          id: mappedId
        });
      } else {
        // Raw value assignment (supports COLOR, FLOAT, STRING, BOOLEAN)
        newVar.setValueForMode(targetModeId, sourceValue);
      }
    }
  }

  // --- GLOBAL RE-BINDING ---
  const allNodes = figma.currentPage.findAll();
  let reboundCount = 0;

  for (const node of allNodes) {
    if ("boundVariables" in node && node.boundVariables) {
      const currentBounds = node.boundVariables;
      const newBounds: any = { ...currentBounds };
      let changed = false;

      // Iteratively check bound fields (fills, strokes, effects, opacity, etc.)
      const fields = Object.keys(currentBounds) as (keyof typeof currentBounds)[];
      
      for (const field of fields) {
        const boundItem = currentBounds[field];
        
        if (Array.isArray(boundItem)) {
          // Complex fields like fills/strokes (arrays of paints)
          const newArray = boundItem.map(bound => {
            if (bound && idRegistry.has(bound.id)) {
              changed = true;
              return { ...bound, id: idRegistry.get(bound.id)! };
            }
            return bound;
          });
          newBounds[field] = newArray;
        } else if (boundItem && typeof boundItem === 'object' && boundItem !== null && 'id' in boundItem) {
          // Simple fields like component properties
          if (idRegistry.has((boundItem as any).id)) {
            newBounds[field] = { ...boundItem, id: idRegistry.get((boundItem as any).id)! };
            changed = true;
          }
        }
      }

      if (changed) {
        node.setBoundVariable(newBounds); // Use bulk setter if possible or individual ones
        reboundCount++;
      }
    }
  }

  figma.notify(`Migrated ${variablesToProcess.length} variables and rebound ${reboundCount} nodes.`);
};

// Plugin Entry Point
figma.showUI(__html__, { width: 800, height: 600, themeColors: true });

figma.ui.onmessage = async (msg: any) => {
  if (msg.type === 'RUN_MIGRATION') {
    try {
      await migrateVariables(
        msg.payload.sourceCollectionId,
        msg.payload.targetCollectionId,
        msg.payload.variableIds
      );
      figma.ui.postMessage({ type: 'MIGRATION_SUCCESS' });
    } catch (e) {
      console.error(e);
      figma.notify("Migration failed: " + (e as Error).message, { error: true });
      figma.ui.postMessage({ type: 'MIGRATION_ERROR', payload: (e as Error).message });
    }
  } else if (msg.type === 'GET_DATA') {
    // Fetch real data from Figma environment
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const formattedCollections = collections.map((c: any) => ({
      id: c.id,
      name: c.name,
      modes: c.modes,
      variableIds: c.variableIds
    }));
    figma.ui.postMessage({ type: 'DATA_LOADED', payload: formattedCollections });
  } else if (msg.type === 'GET_VARIABLES') {
    const collection = await figma.variables.getVariableCollectionByIdAsync(msg.payload.collectionId);
    if (collection) {
      const vars = [];
      for (const id of collection.variableIds) {
        const v = await figma.variables.getVariableByIdAsync(id);
        if (v) {
          vars.push({
            id: v.id,
            name: v.name,
            resolvedType: v.resolvedType,
            description: v.description,
            valuesByMode: v.valuesByMode,
            scopes: v.scopes
          });
        }
      }
      figma.ui.postMessage({ type: 'VARIABLES_LOADED', payload: vars });
    }
  }
};
