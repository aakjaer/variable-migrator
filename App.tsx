import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  RotateCw,
  Palette,
  Layers,
  Check,
  ArrowLeft,
  ArrowRight,
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

interface Section {
  label: string;
  vars: Variable[];
}

const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const leafName = (name: string) => name.split("/").pop() ?? name;

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

  const sortVars = (arr: Variable[]) =>
    [...arr].sort((a, b) => naturalCompare(leafName(a.name), leafName(b.name)));

  const sections: Section[] = [];
  if (ungrouped.length > 0) sections.push({ label: "", vars: sortVars(ungrouped) });
  for (const [label, vars] of [...grouped.entries()].sort(([a], [b]) => naturalCompare(a, b))) {
    sections.push({ label, vars: sortVars(vars) });
  }
  return sections;
}

// ─── Type icon ────────────────────────────────────────────────────────────────

const TypeIcon: React.FC<{ type: string }> = ({ type }) => {
  switch (type) {
    case "COLOR":
      return (
        <Palette
          size={13}
          className="text-green-600 dark:text-violet-400 shrink-0"
        />
      );
    case "FLOAT":
      return (
        <Hash size={13} className="text-blue-600 dark:text-blue-400 shrink-0" />
      );
    case "BOOLEAN":
      return (
        <ToggleLeft
          size={13}
          className="text-emerald-600 dark:text-green-400 shrink-0"
        />
      );
    case "STRING":
      return (
        <Type
          size={13}
          className="text-amber-600 dark:text-yellow-400 shrink-0"
        />
      );
    default:
      return (
        <Palette
          size={13}
          className="text-zinc-500 dark:text-zinc-500 shrink-0"
        />
      );
  }
};

// ─── Value chip ───────────────────────────────────────────────────────────────

const ValueChip: React.FC<{ value?: PreviewValue }> = ({ value }) => {
  if (!value) return null;

  if (value.kind === "alias") {
    const segments = value.name.split("/");
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 text-[12px] font-mono max-w-full min-w-0">
        {value.resolvedColor ? (
          <span
            className="w-3 h-3 rounded-sm border border-zinc-300/50 dark:border-white/10 shrink-0"
            style={{ backgroundColor: value.resolvedColor }}
          />
        ) : (
          <span className="w-3 h-3 rounded-sm border border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700 shrink-0" />
        )}
        <span className="truncate">{segments.join("/")}</span>
      </span>
    );
  }

  if (value.kind === "color") {
    return (
      <span className="inline-flex text-[12px] items-center gap-1.5 text-zinc-600 dark:text-zinc-300 font-mono max-w-full min-w-0">
        <span
          className="w-3 h-3 rounded-sm border border-zinc-300/50 dark:border-white/10 shrink-0"
          style={{ backgroundColor: value.hex }}
        />
        <span className="truncate uppercase">{value.hex}</span>
      </span>
    );
  }

  if (value.kind === "float") {
    return (
      <span className="text-zinc-500 dark:text-zinc-400 text-[12px] font-mono truncate">
        {value.value}
      </span>
    );
  }

  if (value.kind === "boolean") {
    return (
      <span className="text-zinc-500 dark:text-zinc-400 text-[12px] font-mono truncate">
        {value.value ? "true" : "false"}
      </span>
    );
  }

  if (value.kind === "string") {
    return (
      <span className="text-zinc-500 dark:text-zinc-400 text-[12px] font-mono truncate">
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
        className={`flex items-center gap-1 py-1.5 pr-2 rounded cursor-pointer transition-colors
          ${
            isSelected
              ? "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-white"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors shrink-0"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <span className="flex-1 truncate">{node.name}</span>
        <span
          className={`text-xs tabular-nums shrink-0 ${
            isSelected
              ? "text-violet-600 dark:text-zinc-300"
              : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {node.variableIds.length}
        </span>
        {isAllSelected && (
          <Check
            size={11}
            className="text-violet-500 dark:text-violet-400 ml-1 shrink-0"
          />
        )}
        {isPartial && (
          <span className="w-2 h-2 rounded-sm bg-violet-400/50 dark:bg-violet-600/50 ml-1 shrink-0 inline-block" />
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
  const [variablesLoading, setVariablesLoading] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<{ done: number; total: number } | null>(null);
  const [migrationSummary, setMigrationSummary] = useState<{ movedCount: number; replacedCount: number; nodesUpdated: number; stylesUpdated: number } | null>(null);
  const [replaceConflicts, setReplaceConflicts] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [dryRun, setDryRun] = useState<DryRunState>({ status: "idle" });
  const [variablesFetchedAt, setVariablesFetchedAt] = useState(0);
  const [variablesStale, setVariablesStale] = useState(false);
  const autoSelectedRef = useRef(false);
  const lastClickedIdRef = useRef<string | null>(null);

  // Auto-select the first collection the first time collections arrive
  useEffect(() => {
    if (autoSelectedRef.current || collections.length === 0) return;
    autoSelectedRef.current = true;
    const first = collections[0];
    setState((prev) => ({
      ...prev,
      sourceCollectionId: first.id,
      selectedVariableIds: [],
    }));
    setSelectedGroup("");
    setVariablesLoading(true);
    parent.postMessage(
      {
        pluginMessage: {
          type: "GET_VARIABLES",
          payload: { collectionId: first.id },
        },
      },
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
        setVariablesLoading(false);
      } else if (msg.type === "VARIABLES_STALE") {
        setVariablesStale(true);
      } else if (msg.type === "DRY_RUN_RESULT") {
        if (msg.payload.error) {
          setDryRun({ status: "error", code: msg.payload.error });
        } else {
          setDryRun({ status: "done", result: msg.payload });
        }
      } else if (msg.type === "MIGRATION_PROGRESS") {
        setMigrationProgress(msg.payload);
      } else if (msg.type === "MIGRATION_SUCCESS") {
        setLoading(false);
        setMigrationProgress(null);
        setMigrationSummary(msg.payload ?? null);
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

  const currentCollection = useMemo(
    () => collections.find((c) => c.id === state.sourceCollectionId),
    [collections, state.sourceCollectionId],
  );
  const modes = currentCollection?.modes ?? [];
  // checkbox(2.5rem) + name(1fr) + one column per mode + type(5rem)
  const gridCols = `2.5rem 1fr ${modes.map(() => "minmax(0,1fr)").join(" ")} 5rem`;

  const visibleIds = visibleVariables.map((v) => v.id);

  const handleSourceSelect = (id: string) => {
    setState((prev) => ({
      ...prev,
      sourceCollectionId: id,
      selectedVariableIds: [],
    }));
    setSelectedGroup("");
    setVariablesLoading(true);
    parent.postMessage(
      {
        pluginMessage: { type: "GET_VARIABLES", payload: { collectionId: id } },
      },
      "*",
    );
  };

  const handleVariableToggle = (id: string, shiftKey = false) => {
    if (
      shiftKey &&
      lastClickedIdRef.current &&
      lastClickedIdRef.current !== id
    ) {
      const ids = visibleVariables.map((v) => v.id);
      const fromIdx = ids.indexOf(lastClickedIdRef.current);
      const toIdx = ids.indexOf(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [start, end] =
          fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const rangeIds = ids.slice(start, end + 1);
        setState((prev) => ({
          ...prev,
          selectedVariableIds: [
            ...new Set([...prev.selectedVariableIds, ...rangeIds]),
          ],
        }));
        return;
      }
    }
    lastClickedIdRef.current = id;
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
    setMigrationProgress(null);
    setMigrationSummary(null);
    setState((prev) => ({ ...prev, step: "MIGRATING" }));
    parent.postMessage(
      {
        pluginMessage: {
          type: "RUN_MIGRATION",
          payload: {
            sourceCollectionId: state.sourceCollectionId,
            targetCollectionId: state.targetCollectionId,
            variableIds: state.selectedVariableIds,
            replaceConflicts,
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
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white overflow-hidden text-xs">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-zinc-900 p-1 rounded">
            <Layers size={12} className="text-white" />
          </div>
          <h1 className="font-semibold tracking-tight">Variable Migrator</h1>
        </div>
        <RotateCw
          size={18}
          className="text-zinc-400 dark:text-zinc-500 cursor-pointer hover:text-zinc-900 dark:hover:text-white transition-colors"
          onClick={refreshData}
        />
      </header>

      <main className="flex-1 overflow-hidden relative min-h-0 text-xs">
        {/* ── Step 1+2: Collections + variables ── */}
        {state.step === "VARIABLES" && (
          <div className="flex h-full">
            {/* Sidebar */}
            <aside className="w-56 border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex flex-col overflow-hidden shrink-0">
              <div className="flex-1 overflow-y-auto">
                {/* Collections section */}
                <div className="px-3 pt-3 pb-2">
                  <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    Collections
                  </span>
                </div>
                <div className="px-2 pb-2 space-y-0.5">
                  {collections.map((col) => {
                    const isSelected = state.sourceCollectionId === col.id;
                    return (
                      <div
                        key={col.id}
                        onClick={() => handleSourceSelect(col.id)}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer transition-colors
                          ${
                            isSelected
                              ? "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-white"
                              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                          }`}
                      >
                        <span className="flex-1 truncate">{col.name}</span>
                        <span
                          className={`text-xs tabular-nums shrink-0 ${
                            isSelected
                              ? "text-violet-600 dark:text-zinc-300"
                              : "text-zinc-400 dark:text-zinc-500"
                          }`}
                        >
                          {col.variableIds.length}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Groups section — only shown when a collection is active */}
                {state.sourceCollectionId && (
                  <>
                    <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-2" />
                    <div className="px-3 pt-1 pb-2">
                      <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                        Groups
                      </span>
                    </div>
                    <div className="px-2 pb-2 space-y-0.5">
                      {/* All Variables */}
                      <div
                        onClick={() => setSelectedGroup("")}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer transition-colors
                          ${
                            selectedGroup === ""
                              ? "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-white"
                              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                          }`}
                      >
                        <span className="w-[13px] shrink-0" />
                        <span className="flex-1">All</span>
                        <span
                          className={`text-xs tabular-nums shrink-0 ${
                            selectedGroup === ""
                              ? "text-violet-600 dark:text-zinc-300"
                              : "text-zinc-400 dark:text-zinc-500"
                          }`}
                        >
                          {variables.length}
                        </span>
                        {state.selectedVariableIds.length ===
                          variables.length &&
                          variables.length > 0 && (
                            <Check
                              size={11}
                              className="text-violet-500 dark:text-violet-400 ml-1 shrink-0"
                            />
                          )}
                        {state.selectedVariableIds.length > 0 &&
                          state.selectedVariableIds.length <
                            variables.length && (
                            <span className="w-2 h-2 rounded-sm bg-violet-400/50 dark:bg-violet-600/50 ml-1 shrink-0 inline-block" />
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
              </div>
            </aside>

            {/* Main panel */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
              {!state.sourceCollectionId ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-zinc-400 dark:text-zinc-600 text-xs">
                    Select a collection to get started
                  </p>
                </div>
              ) : (
                <>
                  {/* Panel header */}
                  <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-700 flex items-center justify-between shrink-0">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {selectedGroup
                        ? selectedGroup.split("/").join(" / ")
                        : "All Variables"}
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
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
                        <span className="text-yellow-600 dark:text-yellow-400 text-xs">
                          Variables changed in Figma
                        </span>
                      </div>
                      <button
                        onClick={refreshData}
                        className="text-xs text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 underline underline-offset-2 transition-colors"
                      >
                        Refresh
                      </button>
                    </div>
                  )}

                  {/* Column header */}
                  <div
                    className="shrink-0 h-9 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 grid font-semibold text-zinc-500 dark:text-zinc-500 uppercase text-[10px] tracking-wider"
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    <div />
                    <div className="pr-3 flex items-center">Name</div>
                    {modes.map((m) => (
                      <div key={m.modeId} className="px-3 flex items-center truncate">{m.name}</div>
                    ))}
                    <div className="px-3 flex items-center justify-end">Type</div>
                  </div>

                  {/* Variable list with group headers */}
                  <div className="flex-1 overflow-y-auto select-none">
                    {variablesLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <div className="w-4 h-4 border-2 border-zinc-300 dark:border-zinc-600 border-t-violet-500 rounded-full animate-spin" />
                      </div>
                    ) : sections.map((section) => (
                      <div key={section.label || "__root__"}>
                        {/* Group header label */}
                        {section.label &&
                          (() => {
                            const parts = section.label.split("/");
                            const prefix = parts.slice(0, -1).join(" / ");
                            const last = parts[parts.length - 1];
                            return (
                              <div className="px-4 pt-6 pb-2">
                                {prefix && (
                                  <span className="font-semibold text-zinc-400 dark:text-zinc-500">
                                    {prefix} /{" "}
                                  </span>
                                )}
                                <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                                  {last}
                                </span>
                              </div>
                            );
                          })()}
                        {/* Variable rows for this section */}
                        {section.vars.map((v) => {
                          const isSelected = state.selectedVariableIds.includes(
                            v.id,
                          );
                          const displayName = v.name.split("/").pop()!;
                          return (
                            <div
                              key={v.id}
                              onClick={(e) =>
                                handleVariableToggle(v.id, e.shiftKey)
                              }
                              className={`grid h-10 cursor-pointer transition-colors border-t border-zinc-100 dark:border-zinc-800
                                ${
                                  isSelected
                                    ? "bg-violet-100 dark:bg-violet-950"
                                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                                }`}
                              style={{ gridTemplateColumns: gridCols }}
                            >
                              <div className="flex items-center justify-center">
                                <div
                                  className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-colors ${
                                    isSelected
                                      ? "bg-violet-500 border-violet-500"
                                      : "border-zinc-300 dark:border-zinc-600"
                                  }`}
                                >
                                  {isSelected && (
                                    <Check
                                      size={9}
                                      className="text-white shrink-0"
                                    />
                                  )}
                                </div>
                              </div>
                              <div className="pr-2 flex items-center gap-2 min-w-0 overflow-hidden">
                                <TypeIcon type={v.resolvedType} />
                                <span
                                  className={`truncate ${
                                    isSelected
                                      ? "text-violet-900 dark:text-white"
                                      : "text-zinc-700 dark:text-zinc-200"
                                  }`}
                                >
                                  {displayName}
                                </span>
                              </div>
                              {modes.map((m) => (
                                <div key={m.modeId} className="px-3 flex items-center min-w-0 overflow-hidden">
                                  <ValueChip value={v.previewValues[m.modeId]} />
                                </div>
                              ))}
                              <div className="px-4 flex items-center justify-end">
                                <span className="text-zinc-400 dark:text-zinc-600 font-mono uppercase text-xs">
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
                  <footer className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {state.selectedVariableIds.length} selected
                      </span>
                      <button
                        onClick={handleSelectAllVisible}
                        className="hover:text-zinc-900 dark:hover:text-white transition-colors"
                      >
                        Select {selectedGroup ? "Group" : "All"}
                      </button>
                      <button
                        onClick={handleDeselectAllVisible}
                        className="hover:text-zinc-900 dark:hover:text-white transition-colors"
                      >
                        Deselect {selectedGroup ? "Group" : "All"}
                      </button>
                      {fetchedAtLabel && (
                        <span className="text-zinc-400 dark:text-zinc-600">
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
                      className="bg-violet-500 px-4 py-2 rounded-md font-semibold text-xs text-white hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Move to <ArrowRight size={12} className="inline ml-1" />
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
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
                  setReplaceConflicts(false);
                }}
                className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
                          ? "border-violet-500 bg-violet-50 dark:bg-violet-950"
                          : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
                      }`}
                  >
                    <span className="font-medium">{col.name}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-zinc-400 dark:text-zinc-500 text-sm">
                        {col.variableIds.length}
                      </span>
                      {state.targetCollectionId === col.id && (
                        <Check size={18} className="text-violet-500" />
                      )}
                    </div>
                  </button>
                ))}
            </div>
            {/* Dry run results */}
            {state.targetCollectionId && (
              <div className="mb-4">
                {dryRun.status === "loading" && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-400">
                    <div className="w-3.5 h-3.5 border-2 border-zinc-300 dark:border-zinc-600 border-t-violet-500 rounded-full animate-spin shrink-0" />
                    Checking migration…
                  </div>
                )}

                {dryRun.status === "done" && (
                  <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    {dryRun.result.missingCount > 0 && (
                      <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-red-500/5">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle
                            size={13}
                            className="text-red-500 dark:text-red-400 mt-0.5 shrink-0"
                          />
                          <div>
                            <p className="text-red-500 dark:text-red-400 text-xs font-medium mb-0.5">
                              {dryRun.result.missingCount} variable
                              {dryRun.result.missingCount !== 1 ? "s" : ""} no
                              longer exist
                            </p>
                            <p className="text-zinc-500 dark:text-zinc-500 text-xs">
                              Deleted in Figma since loading.{" "}
                              {dryRun.result.missingCount !== 1 ? "They" : "It"}{" "}
                              will be skipped.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {dryRun.result.conflictingNames.length > 0 && (
                      <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-yellow-500/5">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle
                            size={13}
                            className="text-yellow-500 mt-0.5 shrink-0"
                          />
                          <div className="min-w-0 w-full">
                            <p className="text-yellow-600 dark:text-yellow-400 text-xs font-medium mb-1">
                              {dryRun.result.conflictingNames.length} name
                              conflict
                              {dryRun.result.conflictingNames.length !== 1
                                ? "s"
                                : ""}
                            </p>
                            <p className="text-zinc-500 dark:text-zinc-400 text-xs mb-2">
                              {replaceConflicts
                                ? "Existing variables in the target will be overwritten with the source values."
                                : "These variables already exist in the target. Duplicates will be created."}
                            </p>
                            <ul className="space-y-0.5 mb-3">
                              {dryRun.result.conflictingNames
                                .slice(0, 5)
                                .map((name) => (
                                  <li
                                    key={name}
                                    className="text-[11px] text-zinc-500 font-mono truncate"
                                  >
                                    · {name}
                                  </li>
                                ))}
                              {dryRun.result.conflictingNames.length > 5 && (
                                <li className="text-[11px] text-zinc-400 dark:text-zinc-600">
                                  + {dryRun.result.conflictingNames.length - 5}{" "}
                                  more
                                </li>
                              )}
                            </ul>
                            {/* Replace toggle */}
                            <button
                              onClick={() => setReplaceConflicts((v) => !v)}
                              className="flex items-center gap-2 group"
                            >
                              <span
                                className={`relative inline-flex w-7 h-4 rounded-full transition-colors shrink-0 ${
                                  replaceConflicts
                                    ? "bg-violet-500"
                                    : "bg-zinc-300 dark:bg-zinc-600"
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                                    replaceConflicts
                                      ? "translate-x-3.5"
                                      : "translate-x-0.5"
                                  }`}
                                />
                              </span>
                              <span className="text-xs text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
                                Replace existing variables
                              </span>
                            </button>
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
                      className="text-red-500 dark:text-red-400 mt-0.5 shrink-0"
                    />
                    <p className="text-red-500 dark:text-red-400 text-sm">
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
              className="w-full bg-violet-500 py-3 rounded-lg font-bold text-base text-white hover:bg-violet-600 disabled:opacity-50 transition-all"
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
                <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-6" />
                <h2 className="text-2xl font-bold mb-2">
                  {migrationProgress && migrationProgress.total > 0
                    ? "Updating References…"
                    : "Migrating Variables…"}
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-sm mb-6">
                  {migrationProgress && migrationProgress.total > 0
                    ? `${migrationProgress.done.toLocaleString()} / ${migrationProgress.total.toLocaleString()} nodes`
                    : "Creating variables in target collection…"}
                </p>
                <div className="w-full max-w-xs h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  {migrationProgress && migrationProgress.total > 0 ? (
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((migrationProgress.done / migrationProgress.total) * 100)}%` }}
                    />
                  ) : (
                    <div className="h-full bg-violet-500 animate-pulse w-1/3" />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-violet-50 dark:bg-violet-950 border border-violet-500 rounded-full flex items-center justify-center mb-6">
                  <Check size={40} className="text-violet-500" />
                </div>
                <h2 className="text-2xl font-bold mb-4">Migration Complete!</h2>
                {migrationSummary && (
                  <div className="w-full max-w-xs mb-8 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700 text-sm">
                    <div className="flex justify-between px-4 py-2.5">
                      <span className="text-zinc-500 dark:text-zinc-400">Variables moved</span>
                      <span className="font-medium">{migrationSummary.movedCount}</span>
                    </div>
                    {migrationSummary.replacedCount > 0 && (
                      <div className="flex justify-between px-4 py-2.5">
                        <span className="text-zinc-500 dark:text-zinc-400">Conflicts replaced</span>
                        <span className="font-medium">{migrationSummary.replacedCount}</span>
                      </div>
                    )}
                    <div className="flex justify-between px-4 py-2.5">
                      <span className="text-zinc-500 dark:text-zinc-400">Nodes updated</span>
                      <span className="font-medium">{migrationSummary.nodesUpdated}</span>
                    </div>
                    <div className="flex justify-between px-4 py-2.5">
                      <span className="text-zinc-500 dark:text-zinc-400">Styles updated</span>
                      <span className="font-medium">{migrationSummary.stylesUpdated}</span>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => {
                    const targetId = state.targetCollectionId!;
                    setState({
                      sourceCollectionId: targetId,
                      selectedVariableIds: [],
                      targetCollectionId: null,
                      step: "VARIABLES",
                    });
                    setVariables([]);
                    setDryRun({ status: "idle" });
                    setSelectedGroup("");
                    setVariablesLoading(true);
                    parent.postMessage(
                      { pluginMessage: { type: "GET_VARIABLES", payload: { collectionId: targetId } } },
                      "*",
                    );
                  }}
                  className="px-8 py-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg font-medium text-zinc-800 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
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
        className="absolute bottom-1 right-1 w-4 h-4 cursor-nwse-resize z-50 flex items-end justify-end p-0.5 text-zinc-300 dark:text-zinc-600"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M10 0L0 10M10 4L4 10M10 8L8 10"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </div>
    </div>
  );
};

export default App;
