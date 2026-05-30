import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { I } from "../icons";

export interface InputDialogProps {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog({
  open,
  title,
  label,
  initialValue = "",
  placeholder = "",
  confirmLabel = "确定",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // Focus input after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, initialValue]);

  if (!open) return null;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <div className="confirm-dialog-mask" onClick={onCancel}>
      <div
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
      >
        <div className="confirm-dialog-title">
          <I.pencil size={16} />
          <span>{title}</span>
        </div>
        <div className="confirm-dialog-body input-dialog-body">
          <label className="input-dialog-label">{label}</label>
          <input
            ref={inputRef}
            className="input-dialog-input"
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => {
              // Select all text on focus (for rename)
              e.target.select();
            }}
            spellCheck={false}
          />
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-save"
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
