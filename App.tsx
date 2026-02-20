import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  RotateCw,
  Palette,
  Layers,
  Check,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Hash,
  ToggleLeft,
  Type,
  AlertTriangle,
} from "lucide-react";
import {
  Collection,
  Variable,
  MigrationState,
  PreviewValue,
  DryRunResult,
} from "./types";

// ─── Local types ──────────────────────────────────────────────────────────────

type DryRunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: DryRunResult }
  | { status: "error"; code: string };

// ─── Group tree helpers ───────────────────────────────────────────────────────

interface GroupNode {
  name: string;
  fullPath: string;
  children: GroupNode[];
  variableIds: string[];
}

function buildGroupTree(variables: Variable[]): GroupNode {
  const root: GroupNode = {
    name: "root",
    fullPath: "",
    children: [],
    variableIds: [],
  };

  for (const v of variables) {
    const parts = v.name.split("/");
    if (parts.length === 1) {
      root.variableIds.push(v.id);
      continue;
    }
    const groupParts = parts.slice(0, -1);
    let cursor = root;
    let pathSoFar = "";
    for (const part of groupParts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      let child = cursor.children.find((c) => c.fullPath === pathSoFar);
      if (!child) {
        child = {
          name: part,
          fullPath: pathSoFar,
          children: [],
          variableIds: [],
        };
        cursor.children.push(child);
      }
      child.variableIds.push(v.id);
      cursor = child;
    }
  }

  return root;
}

function getGroupVariableIds(
  variables: Variable[],
  groupPath: string,
): string[] {
  if (!groupPath) return variables.map((v) => v.id);
  return variables
    .filter((v) => {
      const parts = v.name.split("/");
      const varGroup = parts.slice(0, -1).join("/");
      return varGroup === groupPath || varGroup.startsWith(groupPath + "/");
    })
    .map((v) => v.id);
}

// ─── Grouped sections builder ─────────────────────────────────────────────────
// Converts a flat variable list into [{label, vars}] sections, inserting a
// header whenever the group prefix changes relative to the selected sidebar group.

interface Section {
  label: string; // group label to display, or "" for ungrouped
  vars: Variable[];
}

function buildSections(
  variables: Variable[],
  selectedGroup: string,
): Section[] {
  const ungrouped: Variable[] = [];
  const grouped = new Map<string, Variable[]>();

  for (const v of variables) {
    const parts = v.name.split("/");
    const fullPrefix = parts.slice(0, -1).join("/");

    const relativePrefix =
      selectedGroup && fullPrefix.startsWith(selectedGroup)
        ? fullPrefix.slice(selectedGroup.length).replace(/^\//, "")
        : fullPrefix;

    if (!relativePrefix) {
      ungrouped.push(v);
    } else {
      if (!grouped.has(relativePrefix)) grouped.set(relativePrefix, []);
      grouped.get(relativePrefix)!.push(v);
    }
  }

  const sections: Section[] = [];
  if (ungrouped.length > 0) sections.push({ label: "", vars: ungrouped });
  for (const [label, vars] of grouped) {
    sections.push({ label, vars });
  }
  return sections;
}

// ─── Type icon ────────────────────────────────────────────────────────────────

const TypeIcon: React.FC<{ type: string }> = ({ type }) => {
  switch (type) {
    case "COLOR":
      return <Palette size={13} className="text-[#7B61FF] shrink-0" />;
    case "FLOAT":
      return <Hash size={13} className="text-blue-400 shrink-0" />;
    case "BOOLEAN":
      return <ToggleLeft size={13} className="text-green-400 shrink-0" />;
    case "STRING":
      return <Type size={13} className="text-yellow-400 shrink-0" />;
    default:
      return <Palette size={13} className="text-gray-500 shrink-0" />;
  }
};

// ─── Value chip ───────────────────────────────────────────────────────────────

const ValueChip: React.FC<{ value?: PreviewValue }> = ({ value }) => {
  if (!value) return null;

  if (value.kind === "alias") {
    const segments = value.name.split("/");
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1E1E1E] border border-[#2C2C2C] text-gray-300 text-[12px] font-mono max-w-full min-w-0">
        <span className="w-3 h-3 rounded-sm border border-[#3C3C3C] bg-[#2C2C2C] shrink-0" />
        <span className="truncate">{segments.join("/")}</span>
      </span>
    );
  }

  if (value.kind === "color") {
    return (
      <span className="inline-flex text-[12px] items-center gap-1.5 text-gray-300 font-mono max-w-full min-w-0">
        <span
          className="w-3 h-3 rounded-sm border border-white/10 shrink-0"
          style={{ backgroundColor: value.hex }}
        />
        <span className="truncate uppercase">{value.hex}</span>
      </span>
    );
  }

  if (value.kind === "float") {
    return (
      <span className="text-gray-400 text-[12px] font-mono truncate">
        {value.value}
      </span>
    );
  }

  if (value.kind === "boolean") {
    return (
      <span className="text-gray-400 text-[12px] font-mono truncate">
        {value.value ? "true" : "false"}
      </span>
    );
  }

  if (value.kind === "string") {
    return (
      <span className="text-gray-400 text-[12px] font-mono truncate">
        &ldquo;{value.value}&rdquo;
      </span>
    );
  }

  return null;
};

// ─── Sidebar group tree node ──────────────────────────────────────────────────

interface GroupTreeNodeProps {
  node: GroupNode;
  depth: number;
  selectedGroup: string;
  onSelect: (path: string) => void;
  selectedVariableIds: string[];
}

const GroupTreeNode: React.FC<GroupTreeNodeProps> = ({
  node,
  depth,
  selectedGroup,
  onSelect,
  selectedVariableIds,
}) => {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedGroup === node.fullPath;
  const selectedCount = node.variableIds.filter((id) =>
    selectedVariableIds.includes(id),
  ).length;
  const isAllSelected =
    selectedCount === node.variableIds.length && node.variableIds.length > 0;
  const isPartial = selectedCount > 0 && !isAllSelected;

  return (
    <div>
      <div
        onClick={() => onSelect(node.fullPath)}
        className={`flex items-center gap-1 py-1.5 pr-2 rounded cursor-pointer text-sm transition-colors
          ${isSelected ? "bg-[#2A2340] text-white" : "hover:bg-[#1E1E1E] text-gray-300"}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-gray-500 hover:text-white transition-colors shrink-0"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <span className="flex-1 truncate">{node.name}</span>
        <span
          className={`text-xs tabular-nums shrink-0 ${isSelected ? "text-gray-300" : "text-gray-500"}`}
        >
          {node.variableIds.length}
        </span>
        {isAllSelected && (
          <Check size={11} className="text-[#7B61FF] ml-1 shrink-0" />
        )}
        {isPartial && (
          <span className="w-2 h-2 rounded-sm bg-[#7B61FF]/50 ml-1 shrink-0 inline-block" />
        )}
      </div>
      {open &&
        hasChildren &&
        node.children.map((child) => (
          <GroupTreeNode
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            selectedGroup={selectedGroup}
            onSelect={onSelect}
            selectedVariableIds={selectedVariableIds}
          />
        ))}
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [state, setState] = useState<MigrationState>({
    sourceCollectionId: null,
    selectedVariableIds: [],
    targetCollectionId: null,
    step: "VARIABLES",
  });
  const [loading, setLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [dryRun, setDryRun] = useState<DryRunState>({ status: "idle" });
  const [variablesFetchedAt, setVariablesFetchedAt] = useState(0);
  const [variablesStale, setVariablesStale] = useState(false);
  const autoSelectedRef = useRef(false);

  // Auto-select the first collection the first time collections arrive
  useEffect(() => {
    if (autoSelectedRef.current || collections.length === 0) return;
    autoSelectedRef.current = true;
    const first = collections[0];
    setState((prev) => ({ ...prev, sourceCollectionId: first.id, selectedVariableIds: [] }));
    setSelectedGroup("");
    parent.postMessage(
      { pluginMessage: { type: "GET_VARIABLES", payload: { collectionId: first.id } } },
      "*",
    );
  }, [collections]);

  useEffect(() => {
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;
      if (msg.type === "DATA_LOADED") {
        setCollections(msg.payload);
      } else if (msg.type === "VARIABLES_LOADED") {
        setVariables(msg.payload);
        setSelectedGroup("");
        setVariablesFetchedAt(Date.now());
        setVariablesStale(false);
      } else if (msg.type === "VARIABLES_STALE") {
        setVariablesStale(true);
      } else if (msg.type === "DRY_RUN_RESULT") {
        if (msg.payload.error) {
          setDryRun({ status: "error", code: msg.payload.error });
        } else {
          setDryRun({ status: "done", result: msg.payload });
        }
      } else if (msg.type === "MIGRATION_SUCCESS") {
        setLoading(false);
        setState((prev) => ({ ...prev, step: "SUCCESS" }));
        parent.postMessage({ pluginMessage: { type: "GET_DATA" } }, "*");
      } else if (msg.type === "MIGRATION_ERROR") {
        setLoading(false);
        setState((prev) => ({ ...prev, step: "VARIABLES" }));
      }
    };
    parent.postMessage({ pluginMessage: { type: "GET_DATA" } }, "*");
  }, []);

  const groupTree = useMemo(() => buildGroupTree(variables), [variables]);

  const visibleVariables = useMemo(() => {
    if (!selectedGroup) return variables;
    return variables.filter((v) => {
      const varGroup = v.name.split("/").slice(0, -1).join("/");
      return (
        varGroup === selectedGroup || varGroup.startsWith(selectedGroup + "/")
      );
    });
  }, [variables, selectedGroup]);

  const sections = useMemo(
    () => buildSections(visibleVariables, selectedGroup),
    [visibleVariables, selectedGroup],
  );

  const visibleIds = visibleVariables.map((v) => v.id);
  const selectedVisible = state.selectedVariableIds.filter((id) =>
    visibleIds.includes(id),
  );
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  const handleSourceSelect = (id: string) => {
    setState((prev) => ({
      ...prev,
      sourceCollectionId: id,
      selectedVariableIds: [],
    }));
    setSelectedGroup("");
    parent.postMessage(
      {
        pluginMessage: { type: "GET_VARIABLES", payload: { collectionId: id } },
      },
      "*",
    );
  };

  const handleVariableToggle = (id: string) => {
    setState((prev) => ({
      ...prev,
      selectedVariableIds: prev.selectedVariableIds.includes(id)
        ? prev.selectedVariableIds.filter((vId) => vId !== id)
        : [...prev.selectedVariableIds, id],
    }));
  };

  const handleSelectAllVisible = () => {
    setState((prev) => ({
      ...prev,
      selectedVariableIds: [
        ...new Set([...prev.selectedVariableIds, ...visibleIds]),
      ],
    }));
  };

  const handleDeselectAllVisible = () => {
    setState((prev) => ({
      ...prev,
      selectedVariableIds: prev.selectedVariableIds.filter(
        (id) => !visibleIds.includes(id),
      ),
    }));
  };

  const handleTargetSelect = (id: string) => {
    setState((prev) => ({ ...prev, targetCollectionId: id }));
    setDryRun({ status: "loading" });
    parent.postMessage(
      {
        pluginMessage: {
          type: "DRY_RUN",
          payload: {
            sourceCollectionId: state.sourceCollectionId,
            targetCollectionId: id,
            variableIds: state.selectedVariableIds,
          },
        },
      },
      "*",
    );
  };

  const runMigration = () => {
    setLoading(true);
    setState((prev) => ({ ...prev, step: "MIGRATING" }));
    parent.postMessage(
      {
        pluginMessage: {
          type: "RUN_MIGRATION",
          payload: {
            sourceCollectionId: state.sourceCollectionId,
            targetCollectionId: state.targetCollectionId,
            variableIds: state.selectedVariableIds,
          },
        },
      },
      "*",
    );
  };

  const refreshData = () => {
    parent.postMessage({ pluginMessage: { type: "GET_DATA" } }, "*");
    if (state.sourceCollectionId) {
      parent.postMessage(
        {
          pluginMessage: {
            type: "GET_VARIABLES",
            payload: { collectionId: state.sourceCollectionId },
          },
        },
        "*",
      );
    }
  };

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    const startWidth = window.innerWidth;
    const startHeight = window.innerHeight;
    const startX = mouseDownEvent.screenX;
    const startY = mouseDownEvent.screenY;
    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(300, startWidth + (e.screenX - startX));
      const newHeight = Math.max(300, startHeight + (e.screenY - startY));
      parent.postMessage(
        {
          pluginMessage: {
            type: "RESIZE_WINDOW",
            payload: { width: newWidth, height: newHeight },
          },
        },
        "*",
      );
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const fetchedAtLabel = variablesFetchedAt
    ? new Date(variablesFetchedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex flex-col h-screen bg-[#0C0C0C] text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#2C2C2C] bg-[#121212] shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-[#7B61FF] p-1 rounded">
            <Layers size={18} className="text-white" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">
            Variable Migrator
          </h1>
        </div>
        <RotateCw
          size={18}
          className="text-gray-400 cursor-pointer hover:text-white transition-colors"
          onClick={refreshData}
        />
      </header>

      <main className="flex-1 overflow-hidden relative min-h-0 text-xs">
        {/* ── Step 1+2: Collections + variables ── */}
        {state.step === "VARIABLES" && (
          <div className="flex h-full">
            {/* Sidebar */}
            <aside className="w-56 border-r border-[#2C2C2C] bg-[#121212] flex flex-col overflow-hidden shrink-0">
              {/* Collections section */}
              <div className="shrink-0">
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Collections
                  </span>
                </div>
                <div className="max-h-40 overflow-y-auto px-2 pb-2 space-y-0.5">
                  {collections.map((col) => {
                    const isSelected = state.sourceCollectionId === col.id;
                    return (
                      <div
                        key={col.id}
                        onClick={() => handleSourceSelect(col.id)}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors
                          ${isSelected ? "bg-[#2A2340] text-white" : "hover:bg-[#1E1E1E] text-gray-300"}`}
                      >
                        <span className="flex-1 truncate">{col.name}</span>
                        <span
                          className={`text-xs tabular-nums shrink-0 ${isSelected ? "text-gray-300" : "text-gray-500"}`}
                        >
                          {col.variableIds.length}
                        </span>
                        {isSelected && (
                          <Check
                            size={11}
                            className="text-[#7B61FF] ml-1 shrink-0"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Groups section — only shown when a collection is active */}
              {state.sourceCollectionId && (
                <>
                  <div className="h-px bg-[#2C2C2C] mb-2 shrink-0" />
                  <div className="px-3 pt-3 pb-1">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Groups
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
                    {/* All Variables */}
                    <div
                      onClick={() => setSelectedGroup("")}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors
                        ${selectedGroup === "" ? "bg-[#2A2340] text-white" : "hover:bg-[#1E1E1E] text-gray-300"}`}
                    >
                      <span className="w-[13px] shrink-0" />
                      <span className="flex-1">All</span>
                      <span
                        className={`text-xs tabular-nums shrink-0 ${selectedGroup === "" ? "text-gray-300" : "text-gray-500"}`}
                      >
                        {variables.length}
                      </span>
                      {state.selectedVariableIds.length === variables.length &&
                        variables.length > 0 && (
                          <Check
                            size={11}
                            className="text-[#7B61FF] ml-1 shrink-0"
                          />
                        )}
                      {state.selectedVariableIds.length > 0 &&
                        state.selectedVariableIds.length < variables.length && (
                          <span className="w-2 h-2 rounded-sm bg-[#7B61FF]/50 ml-1 shrink-0 inline-block" />
                        )}
                    </div>
                    {groupTree.children.map((node) => (
                      <GroupTreeNode
                        key={node.fullPath}
                        node={node}
                        depth={0}
                        selectedGroup={selectedGroup}
                        onSelect={setSelectedGroup}
                        selectedVariableIds={state.selectedVariableIds}
                      />
                    ))}
                  </div>
                </>
              )}
            </aside>

            {/* Main panel */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0C0C0C]">
              {!state.sourceCollectionId ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-gray-600 text-sm">
                    Select a collection to get started
                  </p>
                </div>
              ) : (
                <>
                  {/* Panel header */}
                  <div className="px-4 py-3 border-b border-[#2C2C2C] flex items-center justify-between shrink-0">
                    <span className="text-sm font-medium text-gray-300">
                      {selectedGroup
                        ? selectedGroup.split("/").join(" / ")
                        : "All Variables"}
                    </span>
                    <span className="text-xs text-gray-500">
                      {visibleVariables.length} variables
                    </span>
                  </div>

                  {/* Stale data banner */}
                  {variablesStale && (
                    <div className="flex items-center justify-between px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 shrink-0">
                      <div className="flex items-center gap-2">
                        <AlertTriangle
                          size={12}
                          className="text-yellow-500 shrink-0"
                        />
                        <span className="text-yellow-400 text-xs">
                          Variables changed in Figma
                        </span>
                      </div>
                      <button
                        onClick={refreshData}
                        className="text-xs text-yellow-400 hover:text-yellow-200 underline underline-offset-2 transition-colors"
                      >
                        Refresh
                      </button>
                    </div>
                  )}

                  {/* Variable list with group headers */}
                  <div className="flex-1 overflow-y-auto">
                    {/* Sticky column header */}
                    <div className="sticky top-0 z-10 h-9 bg-[#0C0C0C] border-b border-[#1E1E1E] grid grid-cols-[2.5rem_1fr_1fr_5rem] text-gray-500 uppercase text-[10px] tracking-wider">
                      <div className="px-4 flex items-center">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                !allVisibleSelected &&
                                selectedVisible.length > 0;
                          }}
                          onChange={
                            allVisibleSelected
                              ? handleDeselectAllVisible
                              : handleSelectAllVisible
                          }
                          className="w-4 h-4 cursor-pointer accent-[#7B61FF]"
                        />
                      </div>
                      <div className="px-3 flex items-center">Name</div>
                      <div className="px-3 flex items-center">Value</div>
                      <div className="px-3 flex items-center justify-end">
                        Type
                      </div>
                    </div>

                    {/* Sections */}
                    {sections.map((section) => (
                      <div key={section.label || "__root__"}>
                        {/* Group header label */}
                        {section.label && (
                          <div className="px-4 pt-3 pb-1">
                            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                              {section.label.split("/").pop()}
                            </span>
                          </div>
                        )}
                        {/* Variable rows for this section */}
                        {section.vars.map((v) => {
                          const isSelected = state.selectedVariableIds.includes(
                            v.id,
                          );
                          const displayName = v.name.split("/").pop()!;
                          return (
                            <div
                              key={v.id}
                              onClick={() => handleVariableToggle(v.id)}
                              className={`grid grid-cols-[2.5rem_1fr_1fr_5rem] h-10 cursor-pointer transition-colors border-b border-[#1E1E1E]
                                ${isSelected ? "bg-[#1A1530]" : "hover:bg-[#161616]"}`}
                            >
                              <div className="ps-4 flex items-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleVariableToggle(v.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 cursor-pointer accent-[#7B61FF]"
                                />
                              </div>
                              <div className="px-2 flex items-center gap-2 min-w-0 overflow-hidden">
                                <TypeIcon type={v.resolvedType} />
                                <span
                                  className={`font-medium truncate ${isSelected ? "text-white" : "text-gray-200"}`}
                                >
                                  {displayName}
                                </span>
                              </div>
                              <div className="px-3 flex items-center min-w-0 overflow-hidden">
                                <ValueChip value={v.previewValue} />
                              </div>
                              <div className="px-4 flex items-center justify-end">
                                <span className="text-gray-600 font-mono uppercase text-xs">
                                  {v.resolvedType}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <footer className="px-4 py-3 bg-[#121212] border-t border-[#2C2C2C] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="text-gray-300 font-medium">
                        {state.selectedVariableIds.length} selected
                      </span>
                      <button
                        onClick={handleSelectAllVisible}
                        className="hover:text-white transition-colors"
                      >
                        Select {selectedGroup ? "Group" : "All"}
                      </button>
                      <button
                        onClick={handleDeselectAllVisible}
                        className="hover:text-white transition-colors"
                      >
                        Deselect {selectedGroup ? "Group" : "All"}
                      </button>
                      {fetchedAtLabel && (
                        <span className="text-gray-600">
                          · {fetchedAtLabel}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setState((prev) => ({ ...prev, step: "TARGET" }));
                        setDryRun({ status: "idle" });
                      }}
                      disabled={state.selectedVariableIds.length === 0}
                      className="bg-[#7B61FF] px-5 py-2 rounded-md font-semibold text-sm hover:bg-[#684FF0] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Move To →
                    </button>
                  </footer>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Target collection ── */}
        {state.step === "TARGET" && (
          <div className="p-6 max-w-3xl mx-auto flex flex-col h-full">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">
                  Select destination collection
                </h2>
                <p className="text-sm text-gray-400">
                  Moving {state.selectedVariableIds.length} variable
                  {state.selectedVariableIds.length !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    step: "VARIABLES",
                    targetCollectionId: null,
                  }));
                  setDryRun({ status: "idle" });
                }}
                className="p-2 rounded-full hover:bg-[#1E1E1E] transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 mb-6">
              {collections
                .filter((c) => c.id !== state.sourceCollectionId)
                .map((col) => (
                  <button
                    key={col.id}
                    onClick={() => handleTargetSelect(col.id)}
                    className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all
                      ${
                        state.targetCollectionId === col.id
                          ? "border-[#7B61FF] bg-[#211B3D]"
                          : "bg-[#1E1E1E] border-[#2C2C2C] hover:border-gray-500"
                      }`}
                  >
                    <span className="font-medium">{col.name}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-gray-500 text-sm">
                        {col.variableIds.length}
                      </span>
                      {state.targetCollectionId === col.id && (
                        <Check size={18} className="text-[#7B61FF]" />
                      )}
                    </div>
                  </button>
                ))}
            </div>
            {/* Dry run results */}
            {state.targetCollectionId && (
              <div className="mb-4">
                {dryRun.status === "loading" && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[#1A1A1A] border border-[#2C2C2C] text-sm text-gray-400">
                    <div className="w-3.5 h-3.5 border-2 border-gray-600 border-t-[#7B61FF] rounded-full animate-spin shrink-0" />
                    Checking migration…
                  </div>
                )}

                {dryRun.status === "done" && (
                  <div className="rounded-lg bg-[#1A1A1A] border border-[#2C2C2C] overflow-hidden">
                    <div className="px-4 py-3 flex items-center gap-6 text-sm">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-semibold tabular-nums text-white">
                          {dryRun.result.nodesAffected}
                        </span>
                        <span className="text-gray-500">
                          node
                          {dryRun.result.nodesAffected !== 1 ? "s" : ""}{" "}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-semibold tabular-nums text-white">
                          {dryRun.result.stylesAffected}
                        </span>
                        <span className="text-gray-500">
                          style
                          {dryRun.result.stylesAffected !== 1 ? "s" : ""}{" "}
                        </span>
                      </div>
                    </div>

                    {dryRun.result.missingCount > 0 && (
                      <div className="px-4 py-3 border-t border-[#2C2C2C] bg-red-500/5">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle
                            size={13}
                            className="text-red-400 mt-0.5 shrink-0"
                          />
                          <div>
                            <p className="text-red-400 text-xs font-medium mb-0.5">
                              {dryRun.result.missingCount} variable
                              {dryRun.result.missingCount !== 1 ? "s" : ""} no
                              longer exist
                            </p>
                            <p className="text-gray-500 text-xs">
                              Deleted in Figma since loading.{" "}
                              {dryRun.result.missingCount !== 1 ? "They" : "It"}{" "}
                              will be skipped.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {dryRun.result.conflictingNames.length > 0 && (
                      <div className="px-4 py-3 border-t border-[#2C2C2C] bg-yellow-500/5">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle
                            size={13}
                            className="text-yellow-500 mt-0.5 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-yellow-400 text-xs font-medium mb-1">
                              {dryRun.result.conflictingNames.length} name
                              conflict
                              {dryRun.result.conflictingNames.length !== 1
                                ? "s"
                                : ""}
                            </p>
                            <p className="text-gray-400 text-xs mb-2">
                              These variables already exist in the target.
                              Duplicates will be created.
                            </p>
                            <ul className="space-y-0.5">
                              {dryRun.result.conflictingNames
                                .slice(0, 5)
                                .map((name) => (
                                  <li
                                    key={name}
                                    className="text-[11px] text-gray-500 font-mono truncate"
                                  >
                                    · {name}
                                  </li>
                                ))}
                              {dryRun.result.conflictingNames.length > 5 && (
                                <li className="text-[11px] text-gray-600">
                                  + {dryRun.result.conflictingNames.length - 5}{" "}
                                  more
                                </li>
                              )}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {dryRun.status === "error" && (
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertTriangle
                      size={13}
                      className="text-red-400 mt-0.5 shrink-0"
                    />
                    <p className="text-red-400 text-sm">
                      {dryRun.code === "source_missing"
                        ? "Source collection no longer exists. Go back and refresh."
                        : dryRun.code === "target_missing"
                          ? "This collection no longer exists. Please select another."
                          : "Could not check migration. Please try again."}
                    </p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={runMigration}
              disabled={
                !state.targetCollectionId ||
                loading ||
                dryRun.status === "loading" ||
                dryRun.status === "error"
              }
              className="w-full bg-[#7B61FF] py-3 rounded-lg font-bold text-base hover:bg-[#684FF0] disabled:opacity-50 transition-all"
            >
              {loading
                ? "Processing..."
                : dryRun.status === "loading"
                  ? "Checking…"
                  : "Confirm Move"}
            </button>
          </div>
        )}

        {/* ── Step 4: Migrating / Success ── */}
        {(state.step === "MIGRATING" || state.step === "SUCCESS") && (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            {state.step === "MIGRATING" ? (
              <>
                <div className="w-16 h-16 border-4 border-[#7B61FF] border-t-transparent rounded-full animate-spin mb-6" />
                <h2 className="text-2xl font-bold mb-2">
                  Migrating Variables...
                </h2>
                <p className="text-gray-400 max-w-sm">
                  Moving variables and updating all references across your
                  design.
                </p>
                <div className="w-full max-w-xs mt-8 h-2 bg-[#1E1E1E] rounded-full overflow-hidden">
                  <div className="h-full bg-[#7B61FF] animate-pulse w-[65%]" />
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-[#211B3D] border border-[#7B61FF] rounded-full flex items-center justify-center mb-6">
                  <Check size={40} className="text-[#7B61FF]" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Migration Complete!</h2>
                <p className="text-gray-400 max-w-sm mb-8">
                  All variables have been moved and references updated across
                  your design.
                </p>
                <button
                  onClick={() => {
                    setState({
                      sourceCollectionId: null,
                      selectedVariableIds: [],
                      targetCollectionId: null,
                      step: "VARIABLES",
                    });
                    setVariables([]);
                    setDryRun({ status: "idle" });
                  }}
                  className="px-8 py-3 bg-[#1E1E1E] rounded-lg font-medium hover:bg-[#2C2C2C] transition-colors"
                >
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </main>

      {/* Resize handle */}
      <div
        onMouseDown={startResizing}
        className="absolute bottom-1 right-1 w-4 h-4 cursor-nwse-resize z-50 flex items-end justify-end p-0.5"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.05) 50%)",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{ opacity: 0.4 }}
        >
          <path
            d="M10 0L0 10M10 4L4 10M10 8L8 10"
            stroke="white"
            strokeWidth="1"
          />
        </svg>
      </div>
    </div>
  );
};

export default App;
