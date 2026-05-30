import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "../i18n";
import { I } from "../icons";

export function FileContentViewer({
  filePath,
  onClose,
  onOpenInEditor,
}: {
  filePath: string;
  onClose: () => void;
  onOpenInEditor: (path: string) => void;
}) {
  useLang();
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setContent(null);
    try {
      const text = await invoke<string>("read_text_file", { path: filePath });
      setContent(text);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  return (
    <div className="file-content-viewer">
      <div className="fcv-header">
        <span className="fcv-icon"><I.file size={14} /></span>
        <span className="fcv-name">{fileName}</span>
        <span className="fcv-path">{filePath}</span>
        <div className="fcv-spacer" />
        <button
          type="button"
          className="fcv-btn"
          title="在编辑器中打开"
          onClick={() => onOpenInEditor(filePath)}
        >
          <I.link size={13} />
          <span>打开编辑器</span>
        </button>
        <button
          type="button"
          className="fcv-close"
          title="关闭"
          onClick={onClose}
        >
          <I.x size={14} />
        </button>
      </div>
      <div className="fcv-body">
        {loading ? (
          <div className="fcv-loading">
            <span className="ft-loading-spinner" />
            <span>加载中...</span>
          </div>
        ) : loadError ? (
          <div className="fcv-error">
            <span className="ico"><I.warning size={16} /></span>
            <span>{loadError}</span>
          </div>
        ) : content !== null ? (
          <pre className="fcv-content">{content}</pre>
        ) : null}
      </div>
    </div>
  );
}
