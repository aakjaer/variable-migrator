import React, { useState, useEffect } from "react";
import {
  RotateCw,
  CheckCircle,
  Layout,
  Palette,
  Layers,
  Check,
  ArrowLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Collection, Variable, MigrationState } from "./types";
import { GoogleGenAI } from "@google/genai";

const App: React.FC = () => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [state, setState] = useState<MigrationState>({
    sourceCollectionId: null,
    selectedVariableIds: [],
    targetCollectionId: null,
    step: "SOURCE",
  });
  const [loading, setLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");

  useEffect(() => {
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;

      if (msg.type === "DATA_LOADED") {
        setCollections(msg.payload);
      } else if (msg.type === "VARIABLES_LOADED") {
        setVariables(msg.payload);
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

  const handleSourceSelect = (id: string) => {
    setState((prev) => ({
      ...prev,
      sourceCollectionId: id,
      step: "VARIABLES",
    }));
    parent.postMessage(
      { pluginMessage: { type: "GET_VARIABLES", payload: { collectionId: id } } },
      "*",
    );
  };

  useEffect(() => {
    if (state.step === "SUCCESS") {
      const getAiSummary = async () => {
        if (!process.env.API_KEY) {
          setAiAnalysis(
            "Variable migration complete! Configure an API key to enable expert analysis.",
          );
          return;
        }
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Explain the technical benefits of performing a two-pass variable migration in design systems, specifically focusing on how it preserves aliases and rebinds ${state.selectedVariableIds.length} nodes in Figma. Provide a very concise, 2-sentence expert summary.`,
          });
          setAiAnalysis(response.text || "");
        } catch (error) {
          console.error("AI Analysis failed:", error);
        }
      };
      getAiSummary();
    }
  }, [state.step, state.selectedVariableIds.length]);

  const handleVariableToggle = (id: string) => {
    setState((prev) => ({
      ...prev,
      selectedVariableIds: prev.selectedVariableIds.includes(id)
        ? prev.selectedVariableIds.filter((vId) => vId !== id)
        : [...prev.selectedVariableIds, id],
    }));
  };

  const handleSelectAll = () => {
    setState((prev) => ({
      ...prev,
      selectedVariableIds: variables.map((v) => v.id),
    }));
  };

  const handleDeselectAll = () => {
    setState((prev) => ({ ...prev, selectedVariableIds: [] }));
  };

  const handleMoveTo = () => {
    setState((prev) => ({ ...prev, step: "TARGET" }));
  };

  const handleTargetSelect = (id: string) => {
    setState((prev) => ({ ...prev, targetCollectionId: id }));
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

  const sourceCollection = collections.find(
    (c) => c.id === state.sourceCollectionId,
  );

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    const startWidth = window.innerWidth;
    const startHeight = window.innerHeight;
    const startX = mouseDownEvent.screenX;
    const startY = mouseDownEvent.screenY;

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      const newWidth = Math.max(300, startWidth + (mouseMoveEvent.screenX - startX));
      const newHeight = Math.max(300, startHeight + (mouseMoveEvent.screenY - startY));
      parent.postMessage(
        { pluginMessage: { type: "RESIZE_WINDOW", payload: { width: newWidth, height: newHeight } } },
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

  const refreshData = () => {
    parent.postMessage({ pluginMessage: { type: "GET_DATA" } }, "*");
    if (state.sourceCollectionId) {
      parent.postMessage(
        { pluginMessage: { type: "GET_VARIABLES", payload: { collectionId: state.sourceCollectionId } } },
        "*",
      );
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0C0C0C] text-white overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#2C2C2C] bg-[#121212] shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-[#7B61FF] p-1 rounded">
            <Layers size={18} className="text-white" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">The Variable Migrator</h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#2C2C2C] text-xs font-medium hover:bg-[#2C2C2C] transition-colors">
            <CheckCircle size={14} className="text-[#7B61FF]" />
            Pro Features
          </button>
          <RotateCw
            size={18}
            className="text-gray-400 cursor-pointer hover:text-white transition-colors"
            onClick={refreshData}
          />
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative min-h-0">
        {state.step === "SOURCE" && (
          <div className="p-6 max-w-2xl mx-auto">
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-1">Select the source collection</h2>
              <p className="text-sm text-gray-400">The collection you want to move variables from</p>
            </div>
            <div className="space-y-2">
              {collections.map((col) => (
                <button
                  key={col.id}
                  onClick={() => handleSourceSelect(col.id)}
                  className="w-full flex items-center justify-between p-4 bg-[#1E1E1E] rounded-lg border border-[#2C2C2C] hover:border-[#7B61FF] hover:bg-[#252525] group transition-all"
                >
                  <span className="font-medium">{col.name}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-gray-500 text-sm">{col.variableIds.length}</span>
                    <ChevronRight size={18} className="text-gray-600 group-hover:text-white" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {state.step === "VARIABLES" && (
          <div className="flex h-full">
            <aside className="w-64 border-r border-[#2C2C2C] bg-[#121212] overflow-y-auto">
              <div className="p-4 flex items-center justify-between border-b border-[#2C2C2C]">
                <div className="flex items-center gap-2">
                  <ArrowLeft
                    size={16}
                    className="cursor-pointer text-gray-400"
                    onClick={() => setState((s) => ({ ...s, step: "SOURCE" }))}
                  />
                  <span className="font-semibold text-sm truncate max-w-[120px]">
                    {sourceCollection?.name}
                  </span>
                </div>
                <Layout size={16} className="text-gray-400" />
              </div>
              <div className="p-2 space-y-1">
                <div className="flex items-center justify-between p-2 rounded bg-[#1E1E1E] text-sm cursor-pointer">
                  <span>All Variables</span>
                  <span className="text-xs text-gray-500">{variables.length}</span>
                </div>
              </div>
            </aside>
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0C0C0C]">
              <div className="p-4 border-b border-[#2C2C2C] flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-300">
                  Select the variables you want to move
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="sticky top-0 bg-[#121212] text-gray-500 uppercase text-[10px] tracking-wider z-10">
                    <tr>
                      <th className="px-6 py-2 border-b border-[#2C2C2C] w-12">
                        <input
                          type="checkbox"
                          className="rounded bg-[#2C2C2C] border-none"
                          checked={state.selectedVariableIds.length === variables.length && variables.length > 0}
                          onChange={state.selectedVariableIds.length === variables.length ? handleDeselectAll : handleSelectAll}
                        />
                      </th>
                      <th className="px-4 py-2 border-b border-[#2C2C2C]">Name</th>
                      <th className="px-4 py-2 border-b border-[#2C2C2C]">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variables.map((v) => (
                      <tr
                        key={v.id}
                        className={`hover:bg-[#1E1E1E] transition-colors cursor-pointer group ${state.selectedVariableIds.includes(v.id) ? "bg-[#211B3D]" : ""}`}
                        onClick={() => handleVariableToggle(v.id)}
                      >
                        <td className="px-6 py-4 border-b border-[#1A1A1A]">
                          <div className={`w-5 h-5 rounded border ${state.selectedVariableIds.includes(v.id) ? "bg-[#7B61FF] border-[#7B61FF]" : "border-[#444]"} flex items-center justify-center`}>
                            {state.selectedVariableIds.includes(v.id) && (
                              <Check size={14} className="text-white" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 border-b border-[#1A1A1A]">
                          <div className="flex items-center gap-2">
                            <Palette size={14} className="text-gray-500" />
                            <span className="font-medium text-gray-200">{v.name.split("/").pop()}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 border-b border-[#1A1A1A]">
                          <span className="text-xs text-gray-500 font-mono uppercase">{v.resolvedType}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="p-4 bg-[#121212] border-t border-[#2C2C2C] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span>{state.selectedVariableIds.length} Variables Selected</span>
                  <button onClick={handleSelectAll} className="hover:text-white transition-colors">
                    Select All
                  </button>
                  <button onClick={handleDeselectAll} className="hover:text-white transition-colors">
                    Deselect All
                  </button>
                </div>
                <button
                  onClick={handleMoveTo}
                  disabled={state.selectedVariableIds.length === 0}
                  className="bg-[#7B61FF] px-6 py-2 rounded-md font-semibold text-sm hover:bg-[#684FF0] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Move To
                </button>
              </footer>
            </div>
          </div>
        )}

        {state.step === "TARGET" && (
          <div className="p-6 max-w-3xl mx-auto flex flex-col h-full">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">Select the destination collection</h2>
                <p className="text-sm text-gray-400">The collection you want to move variables to</p>
              </div>
              <button
                onClick={() => setState((s) => ({ ...s, step: "VARIABLES" }))}
                className="p-2 rounded-full hover:bg-[#1E1E1E]"
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
                    className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all ${state.targetCollectionId === col.id ? "border-[#7B61FF] bg-[#211B3D]" : "bg-[#1E1E1E] border-[#2C2C2C] hover:border-gray-500"}`}
                  >
                    <span className="font-medium">{col.name}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-gray-500 text-sm">{col.variableIds.length}</span>
                      {state.targetCollectionId === col.id && (
                        <Check size={18} className="text-[#7B61FF]" />
                      )}
                    </div>
                  </button>
                ))}
            </div>
            <button
              onClick={runMigration}
              disabled={!state.targetCollectionId || loading}
              className="w-full bg-[#7B61FF] py-3 rounded-lg font-bold text-base hover:bg-[#684FF0] disabled:opacity-50 transition-all mb-4"
            >
              {loading ? "Processing..." : "Confirm Move"}
            </button>
          </div>
        )}

        {(state.step === "MIGRATING" || state.step === "SUCCESS") && (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            {state.step === "MIGRATING" ? (
              <>
                <div className="w-16 h-16 border-4 border-[#7B61FF] border-t-transparent rounded-full animate-spin mb-6"></div>
                <h2 className="text-2xl font-bold mb-2">Migrating Variables...</h2>
                <p className="text-gray-400 max-w-sm">
                  Performing two-pass migration to preserve data integrity and rebinding nodes.
                </p>
                <div className="w-full max-w-xs mt-8 h-2 bg-[#1E1E1E] rounded-full overflow-hidden">
                  <div className="h-full bg-[#7B61FF] animate-pulse w-[65%]"></div>
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-[#211B3D] border border-[#7B61FF] rounded-full flex items-center justify-center mb-6">
                  <Check size={40} className="text-[#7B61FF]" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Migration Complete!</h2>
                <p className="text-gray-400 max-w-sm mb-6">
                  All variables have been moved and references updated across your design.
                </p>
                {aiAnalysis && (
                  <div className="max-w-md bg-[#1E1E1E] border border-[#2C2C2C] p-4 rounded-lg text-left relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 text-[#7B61FF]/20 group-hover:text-[#7B61FF]/40 transition-colors">
                      <Sparkles size={24} />
                    </div>
                    <h4 className="text-[#7B61FF] text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <Sparkles size={12} /> Smart Analysis
                    </h4>
                    <p className="text-sm text-gray-300 leading-relaxed italic">"{aiAnalysis}"</p>
                  </div>
                )}
                <button
                  onClick={() =>
                    setState({
                      sourceCollectionId: null,
                      selectedVariableIds: [],
                      targetCollectionId: null,
                      step: "SOURCE",
                    })
                  }
                  className="mt-8 px-8 py-3 bg-[#1E1E1E] rounded-lg font-medium hover:bg-[#2C2C2C] transition-colors"
                >
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </main>

      <div
        onMouseDown={startResizing}
        className="absolute bottom-1 right-1 w-4 h-4 cursor-nwse-resize z-50 flex items-end justify-end p-0.5"
        style={{ background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.05) 50%)" }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.4 }}>
          <path d="M10 0L0 10M10 4L4 10M10 8L8 10" stroke="white" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
};

export default App;
