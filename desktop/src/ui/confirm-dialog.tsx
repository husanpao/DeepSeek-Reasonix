import { useCallback, useEffect, useRef } from "react";
import { I } from "../icons";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  /** Primary action label. Default "保存" */
  saveLabel?: string;
  /** Neutral action label. Default "取消" */
  cancelLabel?: string;
  /** Destructive action label. If omitted, only save+cancel shown */
  discardLabel?: string;
  onSave: () => void;
  onDiscard?: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  saveLabel = "保存",
  cancelLabel = "取消",
  discardLabel,
  onSave,
  onDiscard,
  onCancel,
}: ConfirmDialogProps) {
  const saveRef = useRef<HTMLButtonElement>(null);

  // Focus the save button when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => saveRef.current?.focus());
    }
  }, [open]);

  // Escape → cancel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  if (!open) return null;

  return (
    <div className="confirm-dialog-mask" onClick={onCancel}>
      <div
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="confirm-dialog-title">
          <I.warning size={16} />
          <span>{title}</span>
        </div>
        <div className="confirm-dialog-body">{message}</div>
        <div className="confirm-dialog-actions">
          {discardLabel && onDiscard ? (
            <button type="button" className="confirm-dialog-btn confirm-dialog-discard" onClick={onDiscard}>
              {discardLabel}
            </button>
          ) : null}
          <button type="button" className="confirm-dialog-btn confirm-dialog-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-dialog-btn confirm-dialog-save" ref={saveRef} onClick={onSave}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
