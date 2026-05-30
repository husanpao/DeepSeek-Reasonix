import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { I } from "../icons";
import type { Theme } from "../theme";
import { ConfirmDialog } from "./confirm-dialog";

// Vite worker imports for local monaco workers
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_worker: unknown, label: string) {
    if (label === "typescript" || label === "javascript") {
      return new TsWorker();
    }
    return new EditorWorker();
  },
};

function extToLang(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  const ext = name.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    py: "python",
    rs: "rust",
    rb: "ruby",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    vue: "html",
    svelte: "html",
    swift: "swift",
    kt: "kotlin",
    dart: "dart",
    lua: "lua",
    toml: "ini",
    ini: "ini",
    cfg: "ini",
    conf: "ini",
    env: "ini",
    dockerfile: "dockerfile",
    makefile: "makefile",
    tex: "latex",
    svg: "xml",
    txt: "plaintext",
    log: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

export function FileContentViewer({
  openFiles,
  activeFile,
  theme,
  onSetActiveFile,
  onCloseFile,
}: {
  openFiles: string[];
  activeFile: string | null;
  theme: Theme;
  onSetActiveFile: (path: string) => void;
  onCloseFile: (path: string) => void;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorElRef = useRef<HTMLDivElement>(null);
  const activeFileRef = useRef<string | null>(null);

  // Cache: Map<path, { content: string; original: string; dirty: boolean }>
  const fileCache = useRef<
    Map<string, { content: string; original: string; dirty: boolean }>
  >(new Map());

  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  const [closingFile, setClosingFile] = useState<{ path: string; name: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [batchClosing, setBatchClosing] = useState<{ files: string[]; dirtyCount: number } | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    // Delay to avoid the same click that opened it
    requestAnimationFrame(() => window.addEventListener("click", close, { once: true }));
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // Create editor ONCE on mount
  useEffect(() => {
    const el = editorElRef.current;
    if (!el) return;

    const editor = monaco.editor.create(el, {
      value: "",
      language: "plaintext",
      theme: theme === "dark" ? "vs-dark" : "vs",
      fontSize: 13,
      fontFamily: "Geist Mono, 'Courier New', monospace",
      lineNumbers: "on",
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: "off",
      tabSize: 2,
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      autoClosingBrackets: "always",
      autoIndent: "full",
      formatOnPaste: true,
      cursorBlinking: "smooth",
      smoothScrolling: true,
      padding: { top: 12 },
      readOnly: false,
    });

    editorRef.current = editor;

    // Track dirty state on content change
    editor.onDidChangeModelContent(() => {
      const activePath = activeFileRef.current;
      if (!activePath) return;
      const entry = fileCache.current.get(activePath);
      if (!entry) return;
      entry.content = editor.getValue();
      entry.dirty = entry.content !== entry.original;
    });

    // Ctrl+S — auto-save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      const activePath = activeFileRef.current;
      if (!activePath) return;
      const entry = fileCache.current.get(activePath);
      if (!entry || !entry.dirty) return;
      try {
        await invoke("write_text_file", { path: activePath, content: entry.content });
        entry.original = entry.content;
        entry.dirty = false;
      } catch (err) {
        console.error("save failed", err);
      }
    });

    requestAnimationFrame(() => editor.layout());

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch active file: save current, load new
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // Persist current editor content to cache
    const prevPath = activeFileRef.current;
    if (prevPath) {
      const prevEntry = fileCache.current.get(prevPath);
      if (prevEntry) {
        prevEntry.content = editor.getValue();
        prevEntry.dirty = prevEntry.content !== prevEntry.original;
      }
    }

    activeFileRef.current = activeFile;

    if (!activeFile) return;

    const cached = fileCache.current.get(activeFile);
    if (cached) {
      editor.setValue(cached.content);
    } else {
      setLoadingFiles((prev) => new Set(prev).add(activeFile));
      invoke<string>("read_text_file", { path: activeFile })
        .then((text) => {
          fileCache.current.set(activeFile, {
            content: text,
            original: text,
            dirty: false,
          });
          if (activeFileRef.current === activeFile) {
            editor.setValue(text);
          }
        })
        .catch((err) => {
          console.error("load failed", err);
        })
        .finally(() => {
          setLoadingFiles((prev) => {
            const next = new Set(prev);
            next.delete(activeFile);
            return next;
          });
        });
    }

    // Update language
    const model = editor.getModel();
    if (model) {
      const newLang = extToLang(activeFile);
      if (model.getLanguageId() !== newLang) {
        monaco.editor.setModelLanguage(model, newLang);
      }
    }

    requestAnimationFrame(() => editor.layout());
  }, [activeFile]);

  // Follow theme
  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  // Resize observer
  useEffect(() => {
    const container = document.querySelector(".fcv-body");
    if (!container) return;
    const ro = new ResizeObserver(() => {
      editorRef.current?.layout();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const handleTabContextMenu = useCallback((path: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  const doCloseFiles = useCallback((files: string[]) => {
    files.forEach((f) => fileCache.current.delete(f));
    setLoadingFiles((prev) => {
      const next = new Set(prev);
      files.forEach((f) => next.delete(f));
      return next;
    });
    files.forEach((f) => onCloseFile(f));
  }, [onCloseFile]);

  const doCloseFile = useCallback((path: string) => {
    doCloseFiles([path]);
  }, [doCloseFiles]);

  const promptCloseFile = useCallback((path: string) => {
    const entry = fileCache.current.get(path);
    if (entry?.dirty) {
      setClosingFile({ path, name: path.split(/[\\/]/).pop() ?? path });
      return;
    }
    doCloseFile(path);
  }, []);

  const saveFile = useCallback(async (path: string) => {
    const entry = fileCache.current.get(path);
    if (!entry?.dirty) return;
    const editor = editorRef.current;
    if (editor) entry.content = editor.getValue();
    await invoke("write_text_file", { path, content: entry.content });
    entry.original = entry.content;
    entry.dirty = false;
  }, []);

  // Context menu actions
  const handleCtxClose = useCallback(() => {
    const p = contextMenu?.path;
    setContextMenu(null);
    if (!p) return;
    promptCloseFile(p);
  }, [contextMenu, promptCloseFile]);

  const handleCtxCloseOthers = useCallback(() => {
    const p = contextMenu?.path;
    setContextMenu(null);
    if (!p) return;
    const others = openFiles.filter((f) => f !== p);
    const dirty = others.filter((f) => fileCache.current.get(f)?.dirty);
    if (dirty.length > 0) {
      setBatchClosing({ files: others, dirtyCount: dirty.length });
    } else {
      doCloseFiles(others);
    }
  }, [contextMenu, openFiles, doCloseFiles]);

  const handleCtxCloseRight = useCallback(() => {
    const p = contextMenu?.path;
    setContextMenu(null);
    if (!p) return;
    const idx = openFiles.indexOf(p);
    if (idx < 0) return;
    const right = openFiles.slice(idx + 1);
    if (right.length === 0) return;
    const dirty = right.filter((f) => fileCache.current.get(f)?.dirty);
    if (dirty.length > 0) {
      setBatchClosing({ files: right, dirtyCount: dirty.length });
    } else {
      doCloseFiles(right);
    }
  }, [contextMenu, openFiles, doCloseFiles]);

  const handleCtxCloseSaved = useCallback(() => {
    const p = contextMenu?.path;
    setContextMenu(null);
    const saved = openFiles.filter((f) => {
      const entry = fileCache.current.get(f);
      return f !== p && entry && !entry.dirty;
    });
    doCloseFiles(saved);
  }, [contextMenu, openFiles, doCloseFiles]);

  const handleCtxCloseAll = useCallback(() => {
    setContextMenu(null);
    const dirty = openFiles.filter((f) => fileCache.current.get(f)?.dirty);
    if (dirty.length > 0) {
      setBatchClosing({ files: [...openFiles], dirtyCount: dirty.length });
    } else {
      doCloseFiles([...openFiles]);
    }
  }, [openFiles, doCloseFiles]);

  // Single-file confirm handlers
  const handleConfirmSave = useCallback(async () => {
    const cf = closingFile;
    if (!cf) return;
    setClosingFile(null);
    const editor = editorRef.current;
    const entry = fileCache.current.get(cf.path);
    if (editor && entry) {
      entry.content = editor.getValue();
      try {
        await invoke("write_text_file", { path: cf.path, content: entry.content });
      } catch (err) {
        console.error("save failed", err);
      }
    }
    doCloseFile(cf.path);
  }, [closingFile, doCloseFile]);

  const handleConfirmDiscard = useCallback(() => {
    const cf = closingFile;
    if (!cf) return;
    setClosingFile(null);
    doCloseFile(cf.path);
  }, [closingFile, doCloseFile]);

  const handleConfirmCancel = useCallback(() => {
    setClosingFile(null);
  }, []);
  const handleBatchSave = useCallback(async () => {
    const b = batchClosing;
    if (!b) return;
    setBatchClosing(null);
    for (const f of b.files) {
      try {
        await saveFile(f);
      } catch (err) {
        console.error("save failed", err);
      }
    }
    doCloseFiles(b.files);
  }, [batchClosing, saveFile, doCloseFiles]);

  const handleBatchDiscard = useCallback(() => {
    const b = batchClosing;
    if (!b) return;
    setBatchClosing(null);
    doCloseFiles(b.files);
  }, [batchClosing, doCloseFiles]);

  const handleBatchCancel = useCallback(() => {
    setBatchClosing(null);
  }, []);

  const isLoading = activeFile ? loadingFiles.has(activeFile) : false;
  const showContextMenu = contextMenu !== null;

  const ctxItems = [
    { label: "关闭", fn: handleCtxClose },
    { label: "关闭其他", fn: handleCtxCloseOthers },
    { label: "关闭右侧标签页", fn: handleCtxCloseRight },
    { label: "关闭已保存", fn: handleCtxCloseSaved },
    { label: "全部关闭", fn: handleCtxCloseAll },
  ];

  return (
    <div className="file-content-viewer">
      {/* Tab bar */}
      <div className="editor-tabs">
        {openFiles.map((path) => {
          const name = path.split(/[\\/]/).pop() ?? path;
          const entry = fileCache.current.get(path);
          const isDirty = entry?.dirty ?? false;
          return (
            <div
              key={path}
              className={`editor-tab${path === activeFile ? " active" : ""}`}
              onClick={() => onSetActiveFile(path)}
              onContextMenu={(e) => handleTabContextMenu(path, e)}
            >
              <span className="editor-tab-name">{name}</span>
              {isDirty ? <span className="editor-tab-dirty"> ●</span> : null}
              <button
                type="button"
                className="editor-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  promptCloseFile(path);
                }}
              >
                <I.x size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {showContextMenu ? (
        <div
          className="ctx-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {ctxItems.map((item) => (
            <div key={item.label} className="ctx-menu-item" onClick={item.fn}>
              {item.label}
            </div>
          ))}
        </div>
      ) : null}

      {/* Monaco editor container */}
      <div className="fcv-body">
        <div ref={editorElRef} className="fcv-monaco-editor" />
        {isLoading ? (
          <div className="fcv-loading">
            <span className="ft-loading-spinner" />
            <span>加载中...</span>
          </div>
        ) : null}
        {closingFile ? (
          <ConfirmDialog
            open
            title="未保存的更改"
            message={<>是否在关闭 <strong>{closingFile.name}</strong> 前保存更改？</>}
            saveLabel="保存"
            discardLabel="不保存"
            cancelLabel="取消"
            onSave={handleConfirmSave}
            onDiscard={handleConfirmDiscard}
            onCancel={handleConfirmCancel}
          />
        ) : null}
        {batchClosing ? (
          <ConfirmDialog
            open
            title="未保存的更改"
            message={`有 ${batchClosing.dirtyCount} 个文件有未保存的更改。`}
            saveLabel="保存并关闭"
            discardLabel="不保存直接关闭"
            cancelLabel="取消"
            onSave={handleBatchSave}
            onDiscard={handleBatchDiscard}
            onCancel={handleBatchCancel}
          />
        ) : null}
      </div>
    </div>
  );
}
