import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { t, useLang } from "../i18n";
import { I } from "../icons";

// --------------- types ---------------

interface FileEntry {
  path: string;
  depth: number;
  kind: "dir" | "file";
  name: string;
}

interface GitStatusEntry {
  path: string;
  kind: "untracked" | "added" | "modified" | "deleted" | "renamed";
}

interface TreeNode {
  path: string;
  name: string;
  kind: "dir" | "file";
  children: TreeNode[];
  expanded: boolean;
  loading: boolean;
}

type TabId = "files" | "sessions";

const GIT_STATUS_PRIORITY: Record<string, number> = {
  modified: 0,
  added: 1,
  deleted: 2,
  renamed: 3,
  untracked: 4,
};

function parentDir(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function isDescendantOf(child: string, parent: string): boolean {
  const c = child.replace(/\\/g, "/").toLowerCase();
  const p = parent.replace(/\\/g, "/").toLowerCase();
  if (!p.endsWith("/")) return c.startsWith(p + "/");
  return c.startsWith(p);
}

// --------------- helpers ---------------

function gitStatusIcon(kind: string): string {
  switch (kind) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    default:
      return "";
  }
}

function gitStatusClass(kind: string): string {
  switch (kind) {
    case "modified":
      return "git-m";
    case "added":
      return "git-a";
    case "deleted":
      return "git-d";
    case "renamed":
      return "git-r";
    case "untracked":
      return "git-u";
    default:
      return "";
  }
}

// --------------- FileTree component ---------------

export function FileTree({
  workspaceDir,
  onOpenFile,
  onToggleSidebarTab,
}: {
  workspaceDir?: string;
  onOpenFile: (path: string) => void;
  onToggleSidebarTab: (tab: TabId) => void;
}) {
  useLang();
  const [children, setChildren] = useState<TreeNode[]>([]);
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const expandedRef = useRef<Set<string>>(new Set());
  const treeCache = useRef<Map<string, TreeNode[]>>(new Map());

  // Build children for a given parent path from the flat entry list
  const buildChildren = useCallback(
    (entries: FileEntry[], parentPath: string): TreeNode[] => {
      const normalizedParent = parentPath.replace(/\\/g, "/");
      const direct = entries.filter((e) => parentDir(e.path) === normalizedParent);
      const sorted = [...direct].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return sorted.map((e) => ({
        path: e.path,
        name: e.name,
        kind: e.kind,
        children: e.kind === "dir" ? [] : [],
        expanded: expandedRef.current.has(e.path),
        loading: false,
      }));
    },
    [],
  );

  // Load workspace tree from Tauri backend
  const loadTree = useCallback(async () => {
    if (!workspaceDir) {
      setChildren([]);
      setGitStatusMap(new Map());
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [entries, gitEntries] = await Promise.all([
        invoke<FileEntry[]>("list_workspace_tree", { root: workspaceDir, maxDepth: 4 }),
        invoke<GitStatusEntry[]>("git_status", { root: workspaceDir }),
      ]);

      // Build git status map keyed by absolute path
      const gs = new Map<string, string>();
      for (const ge of gitEntries) {
        const absPath = workspaceDir.replace(/\\/g, "/") + "/" + ge.path.replace(/\\/g, "/");
        // Only keep the highest-priority status per path
        const existing = gs.get(absPath);
        if (existing === undefined || (GIT_STATUS_PRIORITY[ge.kind] ?? 99) < (GIT_STATUS_PRIORITY[existing] ?? 99)) {
          gs.set(absPath, ge.kind);
        }
      }
      setGitStatusMap(gs);

      // Build tree root children
      const rootChildren = buildChildren(entries, workspaceDir.replace(/\\/g, "/"));
      // Cache entries for lazy loading
      treeCache.current.set("__entries", entries as unknown as TreeNode[]);
      setChildren(rootChildren);
    } catch (err) {
      setLoadError(String(err));
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceDir, buildChildren]);

  // Load on mount and when workspaceDir changes
  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const toggleExpand = useCallback(
    async (nodePath: string) => {
      const allEntries = treeCache.current.get("__entries") as unknown as FileEntry[] | undefined;
      if (!allEntries) return;

      if (expandedRef.current.has(nodePath)) {
        expandedRef.current.delete(nodePath);
        // Rebuild children of the root
        const rootChildren = buildChildren(allEntries, workspaceDir?.replace(/\\/g, "/") ?? "");
        setChildren(rootChildren);
      } else {
        expandedRef.current.add(nodePath);
        const rootChildren = buildChildren(allEntries, workspaceDir?.replace(/\\/g, "/") ?? "");
        // Need to recursively expand the node and its children
        const expanded = await expandNode(
          rootChildren,
          nodePath,
          allEntries,
        );
        setChildren(expanded);
      }
    },
    [workspaceDir, buildChildren],
  );

  const expandNode = async (
    nodes: TreeNode[],
    targetPath: string,
    allEntries: FileEntry[],
  ): Promise<TreeNode[]> => {
    const result: TreeNode[] = [];
    for (const node of nodes) {
      if (isDescendantOf(targetPath, node.path) || node.path === targetPath) {
        if (node.kind === "dir") {
          const childNodes = buildChildren(allEntries, node.path);
          const expandedChildren = await expandNode(childNodes, targetPath, allEntries);
          result.push({
            ...node,
            expanded: node.path === targetPath || expandedRef.current.has(node.path),
            children: expandedChildren,
          });
        } else {
          result.push(node);
        }
      } else {
        result.push(node);
      }
    }
    return result;
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const gitStatus = gitStatusMap.get(node.path.replace(/\\/g, "/"));
    const isHidden = node.name.startsWith(".") && node.name !== "..";

    return (
      <div key={node.path}>
        <div
          className={`file-tree-node ${node.kind === "dir" ? "dir" : "file"}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            if (node.kind === "dir") {
              void toggleExpand(node.path);
            } else {
              onOpenFile(node.path);
            }
          }}
          title={node.path}
          role="treeitem"
          aria-expanded={node.kind === "dir" ? node.expanded : undefined}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (node.kind === "dir") {
                void toggleExpand(node.path);
              } else {
                onOpenFile(node.path);
              }
            }
          }}
        >
          {/* Expand/collapse chevron for directories */}
          {node.kind === "dir" ? (
            <span className="ft-chevron" data-expanded={node.expanded || undefined}>
              <I.chev size={10} />
            </span>
          ) : (
            <span className="ft-spacer" />
          )}

          {/* Git status indicator */}
          {gitStatus ? (
            <span className={`ft-git-badge ${gitStatusClass(gitStatus)}`}>
              {gitStatusIcon(gitStatus)}
            </span>
          ) : null}

          {/* Icon */}
          <span className="ft-icon">
            {node.kind === "dir" ? (
              node.expanded ? <I.folder size={13} /> : <I.folder size={13} />
            ) : (
              <I.file size={13} />
            )}
          </span>

          {/* Name */}
          <span className="ft-name" data-hidden={isHidden || undefined}>
            {node.name}
          </span>
        </div>
        {/* Children (expanded directories) */}
        {node.kind === "dir" && node.expanded
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  if (!workspaceDir) {
    return (
      <div className="file-tree-empty">
        <div className="file-tree-empty-icon"><I.folder size={20} /></div>
        <div className="file-tree-empty-text">{t("fileTree.noWorkspace")}</div>
        <button type="button" className="file-tree-empty-btn" onClick={() => onToggleSidebarTab("sessions")}>
          {t("fileTree.setWorkspace")}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="file-tree-loading">
        <span className="ft-loading-spinner" />
        <span>{t("fileTree.loading")}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="file-tree-error">
        <span className="ico"><I.warning size={14} /></span>
        <span>{loadError}</span>
        <button type="button" className="ft-retry-btn" onClick={() => void loadTree()}>
          {t("fileTree.retry")}
        </button>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="file-tree-empty">
        <div className="file-tree-empty-icon"><I.file size={20} /></div>
        <div className="file-tree-empty-text">{t("fileTree.empty")}</div>
      </div>
    );
  }

  return (
    <div className="file-tree" role="tree">
      <div className="file-tree-header">
        <span className="ft-workspace-label">
          {workspaceDir.split(/[\\/]/).pop() || workspaceDir}
        </span>
        <button
          type="button"
          className="ft-refresh-btn"
          title={t("fileTree.refresh")}
          onClick={() => void loadTree()}
        >
          <I.refresh size={12} />
        </button>
      </div>
      <div className="file-tree-scroll">
        {children.map((child) => renderNode(child, 0))}
      </div>
    </div>
  );
}

// --------------- Sidebar tabs component ---------------

export function SidebarTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  useLang();
  return (
    <div className="sidebar-tabs">
      <button
        type="button"
        className="sidebar-tab"
        data-active={activeTab === "sessions" || undefined}
        onClick={() => onTabChange("sessions")}
      >
        <I.history size={13} />
        <span>{t("sidebarTabs.sessions")}</span>
      </button>
      <button
        type="button"
        className="sidebar-tab"
        data-active={activeTab === "files" || undefined}
        onClick={() => onTabChange("files")}
      >
        <I.folder size={13} />
        <span>{t("sidebarTabs.files")}</span>
      </button>
    </div>
  );
}
