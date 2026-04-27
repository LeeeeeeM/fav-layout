import {
  DragEvent as ReactDragEvent,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import GridLayout, { Layout, WidthProvider } from 'react-grid-layout';
import { getLayout, saveLayout } from '../api';
import type { SplitBranch, SplitDirection, SplitLeaf, SplitNode, User, Widget, WorkspaceMode } from '../types';
import { fetchBilibiliMeta, normalizeCoverPic, toBilibiliEmbed } from '../utils/bilibili';

type DashboardPageProps = {
  user: User | null;
  onLogin: (username: string, password: string) => Promise<void>;
  onLogout: () => Promise<void>;
};

const AutoGridLayout = WidthProvider(GridLayout);

const GRID_COLS = 24;
const ROW_HEIGHT_PX = 36;
const DEFAULT_W = 8;
const ASPECT_16_9 = 16 / 9;
const LOCAL_LAYOUT_KEY = 'fav-layout.workspace';
const DND_WIDGET_ID = 'application/x-fav-widget-id';

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** 同一视频可能出现两条相同 id（持久化重复、极端竞态）；列表渲染按 id 去重，保留先出现的条目。 */
function dedupeWidgetsById(items: Widget[]): Widget[] {
  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const w of items) {
    if (seen.has(w.id)) {
      continue;
    }
    seen.add(w.id);
    out.push(w);
  }
  return out;
}

/** 按当前画布宽度把网格里的列宽换算成像素，使默认卡片接近 16:9（宽/高）。 */
function defaultHeightFor169(gridWidthPx: number, w: number): number {
  if (gridWidthPx <= 0 || w <= 0) {
    return 6;
  }
  const colWidthPx = gridWidthPx / GRID_COLS;
  const hFloat = (w * colWidthPx) / (ASPECT_16_9 * ROW_HEIGHT_PX);
  return clamp(Math.round(hFloat), 4, 30);
}

function makeLeaf(widget?: Widget): SplitLeaf {
  return { kind: 'leaf', id: uid(), widget };
}

function defaultSplitRoot(): SplitNode {
  return makeLeaf();
}

function readSplitNode(raw: unknown): SplitNode {
  const parseNode = (input: unknown): SplitNode => {
    if (!input || typeof input !== 'object') {
      return makeLeaf();
    }

    const node = input as Partial<SplitNode>;
    if (node.kind === 'leaf') {
      const leafID = typeof node.id === 'string' ? node.id : uid();
      return {
        kind: 'leaf',
        id: leafID,
        widget: node.widget,
      };
    }

    if (node.kind === 'branch') {
      const branch = node as Partial<SplitBranch>;
      return {
        kind: 'branch',
        id: typeof branch.id === 'string' ? branch.id : uid(),
        direction: branch.direction === 'col' ? 'col' : 'row',
        ratio: typeof branch.ratio === 'number' ? clamp(branch.ratio, 0.15, 0.85) : 0.5,
        first: parseNode(branch.first),
        second: parseNode(branch.second),
      };
    }

    return makeLeaf();
  };

  return parseNode(raw);
}

function splitLeaf(node: SplitNode, leafID: string, direction: SplitDirection): SplitNode {
  if (node.kind === 'leaf') {
    if (node.id !== leafID) {
      return node;
    }
    return {
      kind: 'branch',
      id: uid(),
      direction,
      ratio: 0.5,
      first: makeLeaf(node.widget),
      second: makeLeaf(),
    };
  }

  return {
    ...node,
    first: splitLeaf(node.first, leafID, direction),
    second: splitLeaf(node.second, leafID, direction),
  };
}

function updateBranchRatio(node: SplitNode, branchID: string, ratio: number): SplitNode {
  if (node.kind === 'leaf') {
    return node;
  }

  if (node.id === branchID) {
    return {
      ...node,
      ratio: clamp(ratio, 0.15, 0.85),
    };
  }

  return {
    ...node,
    first: updateBranchRatio(node.first, branchID, ratio),
    second: updateBranchRatio(node.second, branchID, ratio),
  };
}

function findBranchRatio(node: SplitNode, branchID: string): number | null {
  if (node.kind === 'leaf') {
    return null;
  }
  if (node.id === branchID) {
    return node.ratio;
  }
  return findBranchRatio(node.first, branchID) ?? findBranchRatio(node.second, branchID);
}

function assignWidgetToLeaf(node: SplitNode, leafID: string, widget: Widget): { next: SplitNode; replaced?: Widget; assigned: boolean } {
  if (node.kind === 'leaf') {
    if (node.id !== leafID) {
      return { next: node, assigned: false };
    }

    return {
      next: {
        ...node,
        widget,
      },
      replaced: node.widget,
      assigned: true,
    };
  }

  const left = assignWidgetToLeaf(node.first, leafID, widget);
  if (left.assigned) {
    return {
      next: {
        ...node,
        first: left.next,
      },
      replaced: left.replaced,
      assigned: true,
    };
  }

  const right = assignWidgetToLeaf(node.second, leafID, widget);
  if (right.assigned) {
    return {
      next: {
        ...node,
        second: right.next,
      },
      replaced: right.replaced,
      assigned: true,
    };
  }

  return { next: node, assigned: false };
}

function removeWidgetFromLeaf(node: SplitNode, leafID: string): { next: SplitNode; removed?: Widget } {
  if (node.kind === 'leaf') {
    if (node.id !== leafID || !node.widget) {
      return { next: node };
    }

    return {
      next: {
        ...node,
        widget: undefined,
      },
      removed: node.widget,
    };
  }

  const left = removeWidgetFromLeaf(node.first, leafID);
  if (left.removed) {
    return {
      next: {
        ...node,
        first: left.next,
      },
      removed: left.removed,
    };
  }

  const right = removeWidgetFromLeaf(node.second, leafID);
  return {
    next: {
      ...node,
      second: right.next,
    },
    removed: right.removed,
  };
}

function findSplitLeaf(node: SplitNode, leafID: string): SplitLeaf | null {
  if (node.kind === 'leaf') {
    return node.id === leafID ? node : null;
  }
  return findSplitLeaf(node.first, leafID) ?? findSplitLeaf(node.second, leafID);
}

/** 移除指定叶子分区：用另一侧子树顶替；仅剩一块画布时变为空白叶子。 */
function collapseSplitAtLeaf(node: SplitNode, leafID: string): SplitNode {
  if (node.kind === 'leaf') {
    if (node.id === leafID) {
      return makeLeaf();
    }
    return node;
  }

  const { first, second } = node;

  if (first.kind === 'leaf' && first.id === leafID) {
    return second;
  }
  if (second.kind === 'leaf' && second.id === leafID) {
    return first;
  }

  return {
    ...node,
    first: collapseSplitAtLeaf(first, leafID),
    second: collapseSplitAtLeaf(second, leafID),
  };
}

function readLocalWorkspace(): {
  items: Widget[];
  library: Widget[];
  mode: WorkspaceMode;
  splitRoot: SplitNode;
} {
  const raw = window.localStorage.getItem(LOCAL_LAYOUT_KEY);
  if (!raw) {
    return { items: [], library: [], mode: 'free', splitRoot: defaultSplitRoot() };
  }

  try {
    const parsed = JSON.parse(raw) as {
      items?: Widget[];
      library?: Widget[];
      mode?: WorkspaceMode;
      splitRoot?: unknown;
    };

    return {
      items: parsed.items ?? [],
      library: parsed.library ?? [],
      mode: parsed.mode === 'split' ? 'split' : 'free',
      splitRoot: readSplitNode(parsed.splitRoot),
    };
  } catch {
    return { items: [], library: [], mode: 'free', splitRoot: defaultSplitRoot() };
  }
}

function SplitNodeView({
  node,
  hoveredLeafID,
  alwaysShowTools,
  onHoverLeaf,
  onLeaveLeaf,
  onSplitLeaf,
  onDropToLeaf,
  onRemoveLeafWidget,
  onCollapseSplitLeaf,
  onDividerPointerDown,
}: {
  node: SplitNode;
  hoveredLeafID: string | null;
  alwaysShowTools: boolean;
  onHoverLeaf: (leafID: string) => void;
  onLeaveLeaf: () => void;
  onSplitLeaf: (leafID: string, direction: SplitDirection) => void;
  onDropToLeaf: (leafID: string, event: ReactDragEvent<HTMLDivElement>) => void;
  onRemoveLeafWidget: (leafID: string) => void;
  onCollapseSplitLeaf: (leafID: string) => void;
  onDividerPointerDown: (event: ReactPointerEvent<HTMLDivElement>, branchID: string, direction: SplitDirection) => void;
}) {
  if (node.kind === 'leaf') {
    const active = alwaysShowTools || hoveredLeafID === node.id;
    return (
      <div
        className="split-leaf"
        onMouseEnter={() => onHoverLeaf(node.id)}
        onMouseLeave={onLeaveLeaf}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => onDropToLeaf(node.id, e)}
      >
        {node.widget ? (
          <div className="split-widget-card">
            <div className="split-widget-header">
              <span>{node.widget.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveLeafWidget(node.id);
                }}
                aria-label="移除区域视频"
              >
                ×
              </button>
            </div>
            <iframe
              src={node.widget.embedUrl}
              title={node.widget.title}
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <div className="split-leaf-empty">拖拽右侧视频到此区域</div>
        )}

        {active ? (
          <div
            className="split-leaf-tools"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.stopPropagation();
              onDropToLeaf(node.id, e);
            }}
          >
            <button type="button" onClick={() => onSplitLeaf(node.id, 'col')}>
              横向分割
            </button>
            <button type="button" onClick={() => onSplitLeaf(node.id, 'row')}>
              竖向分割
            </button>
            <button type="button" className="split-leaf-tools-merge" onClick={() => onCollapseSplitLeaf(node.id)}>
              移除分区
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const directionClass = node.direction === 'row' ? 'split-row' : 'split-col';
  const dividerClass = node.direction === 'row' ? 'split-divider vertical' : 'split-divider horizontal';

  return (
    <div className={`split-branch ${directionClass}`}>
      <div
        className="split-pane"
        style={{
          flex: `${node.ratio} 1 0`,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <SplitNodeView
          node={node.first}
          hoveredLeafID={hoveredLeafID}
          alwaysShowTools={alwaysShowTools}
          onHoverLeaf={onHoverLeaf}
          onLeaveLeaf={onLeaveLeaf}
          onSplitLeaf={onSplitLeaf}
          onDropToLeaf={onDropToLeaf}
          onRemoveLeafWidget={onRemoveLeafWidget}
          onCollapseSplitLeaf={onCollapseSplitLeaf}
          onDividerPointerDown={onDividerPointerDown}
        />
      </div>

      <div className={dividerClass} onPointerDown={(e) => onDividerPointerDown(e, node.id, node.direction)} />

      <div
        className="split-pane"
        style={{
          flex: `${1 - node.ratio} 1 0`,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <SplitNodeView
          node={node.second}
          hoveredLeafID={hoveredLeafID}
          alwaysShowTools={alwaysShowTools}
          onHoverLeaf={onHoverLeaf}
          onLeaveLeaf={onLeaveLeaf}
          onSplitLeaf={onSplitLeaf}
          onDropToLeaf={onDropToLeaf}
          onRemoveLeafWidget={onRemoveLeafWidget}
          onCollapseSplitLeaf={onCollapseSplitLeaf}
          onDividerPointerDown={onDividerPointerDown}
        />
      </div>
    </div>
  );
}

export default function DashboardPage({ user, onLogin, onLogout }: DashboardPageProps) {
  const [urlInput, setUrlInput] = useState('');
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [library, setLibrary] = useState<Widget[]>([]);
  const [mode, setMode] = useState<WorkspaceMode>('free');
  const [splitRoot, setSplitRoot] = useState<SplitNode>(defaultSplitRoot());

  const [message, setMessage] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [hoveredLeafID, setHoveredLeafID] = useState<string | null>(null);
  const [alwaysShowSplitTools, setAlwaysShowSplitTools] = useState(false);

  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const libraryMetaRequested = useRef(new Set<string>());
  const isResizingSplitRef = useRef(false);
  const [saveNonce, setSaveNonce] = useState(0);
  type FreeHistorySnapshot = { label: string; at: number; widgets: Widget[] };
  type SplitHistorySnapshot = { label: string; at: number; splitRoot: SplitNode };

  const freeCanvasOpSnapshotRef = useRef<FreeHistorySnapshot | null>(null);
  const splitOpSnapshotRef = useRef<SplitHistorySnapshot | null>(null);

  const [freePast, setFreePast] = useState<FreeHistorySnapshot[]>([]);
  const [freeFuture, setFreeFuture] = useState<FreeHistorySnapshot[]>([]);
  const [splitPast, setSplitPast] = useState<SplitHistorySnapshot[]>([]);
  const [splitFuture, setSplitFuture] = useState<SplitHistorySnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [freeCanvasWidth, setFreeCanvasWidth] = useState(() =>
    typeof window !== 'undefined' ? Math.min(window.innerWidth - 140, 1024) : 960,
  );

  const [showLogin, setShowLogin] = useState(false);
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('admin123');
  const [loginError, setLoginError] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const loginFirstInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  function closeLoginModal() {
    setShowLogin(false);
    setLoginPending(false);
    setLoginError('');
  }

  function closeUserMenu() {
    setUserMenuOpen(false);
  }

  useEffect(() => {
    let canceled = false;

    async function bootstrap() {
      setInitialized(false);

      if (!user) {
        const localState = readLocalWorkspace();
        if (!canceled) {
          setWidgets(dedupeWidgetsById(localState.items));
          setLibrary(dedupeWidgetsById(localState.library));
          setMode(localState.mode);
          setSplitRoot(localState.splitRoot);
          setMessage('未登录：配置保存在 localStorage');
          setInitialized(true);
        }
        return;
      }

      try {
        const data = await getLayout();
        if (!canceled) {
          setWidgets(dedupeWidgetsById(data.items ?? []));
          setLibrary(dedupeWidgetsById(data.library ?? []));
          setMode(data.mode === 'split' ? 'split' : 'free');
          setSplitRoot(readSplitNode(data.splitRoot));
          setMessage('已登录：配置保存在后端');
        }
      } catch {
        if (!canceled) {
          setMessage('加载布局失败');
        }
      } finally {
        if (!canceled) {
          setInitialized(true);
        }
      }
    }

    void bootstrap();
    return () => {
      canceled = true;
    };
  }, [user]);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) {
      return;
    }

    const sync = () => setFreeCanvasWidth(el.clientWidth);
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(hover: none), (pointer: coarse)');
    if (!mq) {
      return;
    }
    const sync = () => setAlwaysShowSplitTools(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => {
      mq.removeEventListener?.('change', sync);
    };
  }, []);

  function captureFree(label: string): FreeHistorySnapshot {
    return { label, at: Date.now(), widgets };
  }

  function captureSplit(label: string): SplitHistorySnapshot {
    return { label, at: Date.now(), splitRoot };
  }

  function pushFree(label: string) {
    setFreePast((prev) => {
      const next = [...prev, captureFree(label)];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
    setFreeFuture([]);
  }

  function pushFreeSnapshot(snapshot: FreeHistorySnapshot) {
    setFreePast((prev) => {
      const next = [...prev, snapshot];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
    setFreeFuture([]);
  }

  function pushSplit(label: string) {
    setSplitPast((prev) => {
      const next = [...prev, captureSplit(label)];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
    setSplitFuture([]);
  }

  function pushSplitSnapshot(snapshot: SplitHistorySnapshot) {
    setSplitPast((prev) => {
      const next = [...prev, snapshot];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
    setSplitFuture([]);
  }

  function applyFree(snapshot: FreeHistorySnapshot) {
    setWidgets(snapshot.widgets);
    setMessage(`已回退：${snapshot.label}`);
    setShowHistory(false);
  }

  function applySplit(snapshot: SplitHistorySnapshot) {
    setSplitRoot(snapshot.splitRoot);
    setMessage(`已回退：${snapshot.label}`);
    setShowHistory(false);
  }

  function undo() {
    if (mode === 'split') {
      setSplitPast((prevPast) => {
        if (prevPast.length === 0) return prevPast;
        const snapshot = prevPast[prevPast.length - 1];
        setSplitFuture((prevFuture) => [captureSplit('当前状态'), ...prevFuture].slice(0, 60));
        applySplit(snapshot);
        return prevPast.slice(0, -1);
      });
      return;
    }

    setFreePast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const snapshot = prevPast[prevPast.length - 1];
      setFreeFuture((prevFuture) => [captureFree('当前状态'), ...prevFuture].slice(0, 60));
      applyFree(snapshot);
      return prevPast.slice(0, -1);
    });
  }

  function redo() {
    if (mode === 'split') {
      setSplitFuture((prevFuture) => {
        if (prevFuture.length === 0) return prevFuture;
        const [snapshot, ...rest] = prevFuture;
        setSplitPast((prevPast) => [...prevPast, captureSplit('当前状态')].slice(-60));
        applySplit(snapshot);
        return rest;
      });
      return;
    }

    setFreeFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const [snapshot, ...rest] = prevFuture;
      setFreePast((prevPast) => [...prevPast, captureFree('当前状态')].slice(-60));
      applyFree(snapshot);
      return rest;
    });
  }

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === 'input' ||
        tag === 'textarea' ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isTyping) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) {
        return;
      }

      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [widgets, splitRoot, mode]);

  const default169H = useMemo(() => defaultHeightFor169(freeCanvasWidth, DEFAULT_W), [freeCanvasWidth]);

  useEffect(() => {
    if (!initialized) {
      return;
    }

    // 清理已删除条目的请求标记，避免 Set 无限增长
    const liveIDs = new Set(library.map((w) => w.id));
    for (const id of libraryMetaRequested.current) {
      if (!liveIDs.has(id)) {
        libraryMetaRequested.current.delete(id);
      }
    }

    for (const w of library) {
      if (libraryMetaRequested.current.has(w.id)) {
        continue;
      }
      const needsMeta = !w.coverUrl || !w.upName;
      if (!needsMeta) {
        continue;
      }

      libraryMetaRequested.current.add(w.id);
      const source = w.inputUrl || w.embedUrl;
      void (async () => {
        const meta = await fetchBilibiliMeta(source);
        if (!meta?.pic) {
          return;
        }

        const pic = normalizeCoverPic(meta.pic);
        setLibrary((prev) =>
          prev.map((item) =>
            item.id !== w.id
              ? item
              : {
                  ...item,
                  title: meta.title ? meta.title : item.title,
                  coverUrl: pic,
                  upName: meta.upName ?? item.upName,
                },
          ),
        );
      })();
    }
  }, [initialized, library]);

  useEffect(() => {
    if (!initialized) {
      return;
    }

    if (isResizingSplitRef.current) {
      return;
    }

    const timer = window.setTimeout(async () => {
      const payload = {
        items: widgets,
        library,
        mode,
        splitRoot,
      };

      setSaving(true);
      try {
        if (user) {
          await saveLayout(payload);
        } else {
          window.localStorage.setItem(LOCAL_LAYOUT_KEY, JSON.stringify(payload));
        }
        setSavedAt(Date.now());
      } catch {
        setMessage(user ? '配置保存失败' : 'localStorage 保存失败');
      } finally {
        setSaving(false);
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [widgets, library, mode, splitRoot, initialized, user, saveNonce]);

  useEffect(() => {
    if (!showLogin) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => loginFirstInputRef.current?.focus(), 0);

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLoginModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showLogin]);

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeUserMenu();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const el = userMenuRef.current;
      if (!el) {
        return;
      }
      if (!el.contains(e.target as Node)) {
        closeUserMenu();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [userMenuOpen]);

  const layout = useMemo<Layout[]>(
    () =>
      widgets.map((item) => ({
        i: item.id,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: 4,
        minH: 4,
      })),
    [widgets],
  );

  function addToLibrary() {
    const parsed = toBilibiliEmbed(urlInput);
    if (!parsed) {
      setMessage('链接不合法，支持 BV/av 形式的 B 站视频链接');
      return;
    }

    const next: Widget = {
      id: uid(),
      title: parsed.title,
      inputUrl: urlInput.trim(),
      embedUrl: parsed.embedUrl,
      x: 0,
      y: 0,
      w: DEFAULT_W,
      h: default169H,
    };

    setLibrary((prev) => dedupeWidgetsById([next, ...prev]));
    setUrlInput('');
    setMessage('已加入右侧列表，拖到左侧区域');
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addToLibrary();
    }
  }

  function onLayoutChange(nextLayout: Layout[]) {
    setWidgets((prev) => {
      const map = new Map(nextLayout.map((l) => [l.i, l]));
      return prev.map((item) => {
        const l = map.get(item.id);
        if (!l) {
          return item;
        }
        return {
          ...item,
          x: clamp(l.x, 0, GRID_COLS),
          y: Math.max(0, l.y),
          w: clamp(l.w, 4, GRID_COLS),
          h: clamp(l.h, 4, 30),
        };
      });
    });
  }

  function onLibraryDragStart(event: ReactDragEvent<HTMLDivElement>, id: string) {
    event.dataTransfer.setData(DND_WIDGET_ID, id);
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'copy';
  }

  function onDropFromLibraryToFreeCanvas(_layout: Layout[], droppedItem: Layout, event: Event) {
    const dragEvent = event as DragEvent;
    const draggedID = dragEvent.dataTransfer?.getData(DND_WIDGET_ID) ?? dragEvent.dataTransfer?.getData('text/plain') ?? '';
    if (!draggedID) {
      return;
    }

    const source = library.find((item) => item.id === draggedID);
    if (!source) {
      return;
    }

    const placed: Widget = {
      ...source,
      id: uid(),
      x: clamp(droppedItem.x, 0, GRID_COLS),
      y: Math.max(0, droppedItem.y),
      w: DEFAULT_W,
      h: default169H,
    };

    pushFree('拖入自由画布');
    setWidgets((prev) => [...prev, placed]);
    setMessage('已拖拽到自由画布');
  }

  function onDropToSplitLeaf(leafID: string, event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    const draggedID = event.dataTransfer.getData(DND_WIDGET_ID) || event.dataTransfer.getData('text/plain');
    if (!draggedID) {
      return;
    }

    const source = library.find((item) => item.id === draggedID);
    if (!source) {
      return;
    }

    let assigned = false;
    let replacedTitle: string | null = null;
    const instance: Widget = {
      ...source,
      id: uid(),
      x: 0,
      y: 0,
      w: DEFAULT_W,
      h: default169H,
    };

    setSplitRoot((prev) => {
      const result = assignWidgetToLeaf(prev, leafID, instance);
      assigned = result.assigned;
      replacedTitle = result.replaced?.title ?? null;
      return result.assigned ? result.next : prev;
    });

    if (!assigned) {
      setMessage('未能放入该区域：请拖到格子空白处（不要只碰到分割条）；若刚切过分屏请再拖一次');
      return;
    }

    pushSplit(replacedTitle ? `替换分屏视频：${replacedTitle}` : '放入分屏区域');
    setMessage(replacedTitle ? `已替换分屏区域视频：${replacedTitle}` : '视频已放入分屏区域');
  }

  function handleSplitLeaf(leafID: string, direction: SplitDirection) {
    pushSplit(direction === 'col' ? '横向分割区域' : '竖向分割区域');
    setSplitRoot((prev) => splitLeaf(prev, leafID, direction));
    setMessage(direction === 'col' ? '已横向分割区域' : '已竖向分割区域');
  }

  function handleDividerPointerDown(event: ReactPointerEvent<HTMLDivElement>, branchID: string, direction: SplitDirection) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();

    const dividerEl = event.currentTarget;
    const container = dividerEl.parentElement;
    if (!container) {
      return;
    }

    const pointerId = event.pointerId;

    try {
      dividerEl.setPointerCapture(pointerId);
    } catch {
      //
    }

    const rect = container.getBoundingClientRect();
    const startRatio = findBranchRatio(splitRoot, branchID) ?? 0.5;
    if (!splitOpSnapshotRef.current) {
      splitOpSnapshotRef.current = captureSplit('调整分割线比例');
    }

    const startX = event.clientX;
    const startY = event.clientY;

    const cleanup = () => {
      dividerEl.removeEventListener('pointermove', onMove);
      dividerEl.removeEventListener('pointerup', end);
      dividerEl.removeEventListener('pointercancel', end);
      dividerEl.removeEventListener('lostpointercapture', onLostCapture);
      document.body.style.userSelect = '';
      try {
        dividerEl.releasePointerCapture(pointerId);
      } catch {
        //
      }
      if (isResizingSplitRef.current) {
        isResizingSplitRef.current = false;
        setSaveNonce((v) => v + 1);
      }
      const snapshot = splitOpSnapshotRef.current;
      splitOpSnapshotRef.current = null;
      if (snapshot) {
        pushSplitSnapshot(snapshot);
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const delta = direction === 'row' ? moveEvent.clientX - startX : moveEvent.clientY - startY;
      const size = direction === 'row' ? rect.width : rect.height;
      if (size <= 0) {
        return;
      }
      const nextRatio = clamp(startRatio + delta / size, 0.15, 0.85);
      setSplitRoot((prev) => updateBranchRatio(prev, branchID, nextRatio));
    };

    const end = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
    };

    const onLostCapture = () => {
      cleanup();
    };

    document.body.style.userSelect = 'none';
    isResizingSplitRef.current = true;
    dividerEl.addEventListener('pointermove', onMove);
    dividerEl.addEventListener('pointerup', end);
    dividerEl.addEventListener('pointercancel', end);
    dividerEl.addEventListener('lostpointercapture', onLostCapture);
  }

  function removeWidget(id: string) {
    pushFree('移除自由画布视频');
    setWidgets((prev) => prev.filter((item) => item.id !== id));
  }

  function removeLibraryItem(id: string) {
    setLibrary((prev) => prev.filter((item) => item.id !== id));
  }

  function removeSplitLeafWidget(leafID: string) {
    const result = removeWidgetFromLeaf(splitRoot, leafID);
    if (!result.removed) {
      return;
    }

    pushSplit('移除分屏区域视频');
    setSplitRoot(result.next);
    setMessage('已从分屏区域移除视频');
  }

  function handleCollapseSplitLeaf(leafID: string) {
    const leaf = findSplitLeaf(splitRoot, leafID);
    const widget = leaf?.widget;
    const next = collapseSplitAtLeaf(splitRoot, leafID);
    pushSplit('移除分区');
    setSplitRoot(next);
    setMessage(widget ? '已移除分区（该区域视频已移除）' : '已移除分区');
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError('');
    setLoginPending(true);
    try {
      await onLogin(loginUsername, loginPassword);
      closeLoginModal();
      setMessage('登录成功，已切换到后端保存');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoginPending(false);
    }
  }

  return (
    <div className="dashboard-page">
      <header className="top-bar">
        <div>
          <h2>自定义视频布局</h2>
        </div>

        <div className="auth-actions">
          {user ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-menu-trigger"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <span className="user-menu-name">{user.username}</span>
                <span className="user-menu-caret" aria-hidden="true">
                  ▾
                </span>
              </button>

              {userMenuOpen ? (
                <div className="user-menu-popover" role="menu" aria-label="用户菜单">
                  <button
                    type="button"
                    className="user-menu-item"
                    role="menuitem"
                    onClick={() => {
                      closeUserMenu();
                      setMessage('个人资料页：待实现');
                    }}
                  >
                    个人资料
                  </button>
                  <button
                    type="button"
                    className="user-menu-item danger"
                    role="menuitem"
                    onClick={() => {
                      closeUserMenu();
                      void onLogout();
                    }}
                  >
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="auth-guest-row">
                <button onClick={() => setShowLogin(true)}>登录</button>
                <button
                  type="button"
                  className="guest-info"
                  aria-label="游客模式信息"
                  data-tooltip="当前为游客模式（localStorage）"
                >
                  i
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {showLogin ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeLoginModal();
            }
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="登录"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">登录</div>
              <button type="button" className="modal-close" onClick={closeLoginModal} aria-label="关闭">
                ×
              </button>
            </div>

            <form className="modal-body" onSubmit={handleLoginSubmit}>
              <label htmlFor="login-username">用户名</label>
              <input
                ref={loginFirstInputRef}
                id="login-username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                autoComplete="username"
                required
              />

              <label htmlFor="login-password">密码</label>
              <input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              {loginError ? <div className="error-text">{loginError}</div> : null}
              <button type="submit" disabled={loginPending}>
                {loginPending ? '登录中...' : '确认登录'}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div className="workspace-mode-row">
        <button className={mode === 'free' ? 'active' : ''} onClick={() => setMode('free')}>
          自由模式
        </button>
        <button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>
          分屏模式
        </button>
      </div>

      <div className="workspace">
        <section className="canvas-pane">
          <h3>{mode === 'free' ? '左侧自由画布' : '左侧分屏画布'}</h3>
          <div className="canvas-wrap" ref={canvasWrapRef}>
            {mode === 'free' ? (
              <AutoGridLayout
                className="layout"
                layout={layout}
                cols={GRID_COLS}
                rowHeight={ROW_HEIGHT_PX}
                isDroppable
                droppingItem={{ i: '__dropping__', w: DEFAULT_W, h: default169H }}
                onDropDragOver={() => ({ w: DEFAULT_W, h: default169H })}
                onDrop={onDropFromLibraryToFreeCanvas}
                onLayoutChange={onLayoutChange}
                onDragStart={() => {
                  if (!freeCanvasOpSnapshotRef.current) {
                    freeCanvasOpSnapshotRef.current = captureFree('移动自由画布条目');
                  }
                }}
                onDragStop={() => {
                  const snapshot = freeCanvasOpSnapshotRef.current;
                  freeCanvasOpSnapshotRef.current = null;
                  if (snapshot) {
                    pushFreeSnapshot(snapshot);
                  }
                }}
                onResizeStart={() => {
                  if (!freeCanvasOpSnapshotRef.current) {
                    freeCanvasOpSnapshotRef.current = captureFree('调整自由画布大小');
                  }
                }}
                onResizeStop={() => {
                  const snapshot = freeCanvasOpSnapshotRef.current;
                  freeCanvasOpSnapshotRef.current = null;
                  if (snapshot) {
                    pushFreeSnapshot(snapshot);
                  }
                }}
                draggableHandle=".video-card-header"
                draggableCancel="button"
              >
                {widgets.map((item) => (
                  <div key={item.id} className="video-card">
                    <div className="video-card-header">
                      <div className="video-card-title">{item.title}</div>
                      <button onClick={() => removeWidget(item.id)} aria-label="删除窗口">
                        ×
                      </button>
                    </div>
                    <iframe
                      src={item.embedUrl}
                      title={item.title}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  </div>
                ))}
              </AutoGridLayout>
            ) : (
              <div className="split-canvas">
                <SplitNodeView
                  node={splitRoot}
                  hoveredLeafID={hoveredLeafID}
                  alwaysShowTools={alwaysShowSplitTools}
                  onHoverLeaf={setHoveredLeafID}
                  onLeaveLeaf={() => setHoveredLeafID(null)}
                  onSplitLeaf={handleSplitLeaf}
                  onDropToLeaf={onDropToSplitLeaf}
                  onRemoveLeafWidget={removeSplitLeafWidget}
                  onCollapseSplitLeaf={handleCollapseSplitLeaf}
                  onDividerPointerDown={handleDividerPointerDown}
                />
              </div>
            )}

            {mode === 'free' && widgets.length === 0 ? <div className="canvas-empty">把右侧条目拖到这里</div> : null}
          </div>
        </section>

        <aside className="side-pane">
          <h3>右侧列表</h3>
          <div className="input-row side-input-row">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="粘贴 B 站链接后回车"
            />
            <button onClick={addToLibrary}>添加</button>
          </div>

          <div className="library-list">
            {library.length === 0 ? (
              <div className="library-empty">暂无条目，先添加链接</div>
            ) : (
              library.map((item) => (
                <div
                  key={item.id}
                  className="library-item"
                  draggable
                  onDragStart={(e) => onLibraryDragStart(e, item.id)}
                  title="拖到左侧画布"
                >
                  <div className="library-item-thumb">
                    {item.coverUrl ? (
                      <img
                        src={normalizeCoverPic(item.coverUrl)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="library-thumb-placeholder" />
                    )}
                  </div>
                  <div className="library-item-main">
                    <div className="library-item-title">{item.title}</div>
                    {item.upName ? <div className="library-item-up">UP：{item.upName}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="library-item-remove"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLibraryItem(item.id);
                    }}
                    aria-label="移除条目"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <div className="hint-row">
        <span>
          {message ||
            (mode === 'free'
              ? '自由模式：右侧拖到任意网格位置'
              : '分屏模式：悬浮区域可调分割线与移除分区；标题栏移除视频或移除整块分区')}
          <button
            type="button"
            className="hint-undo"
            disabled={mode === 'split' ? splitPast.length === 0 : freePast.length === 0}
            onClick={undo}
          >
            撤销
          </button>
          <button
            type="button"
            className="hint-undo"
            disabled={mode === 'split' ? splitFuture.length === 0 : freeFuture.length === 0}
            onClick={redo}
          >
            重做
          </button>
          <button
            type="button"
            className="hint-undo"
            disabled={mode === 'split' ? splitPast.length === 0 && splitFuture.length === 0 : freePast.length === 0 && freeFuture.length === 0}
            onClick={() => setShowHistory((v) => !v)}
          >
            历史
          </button>
        </span>
        <span>{saving ? '保存中...' : savedAt && Date.now() - savedAt < 1500 ? '已保存' : ''}</span>
      </div>

      {showHistory ? (
        <div className="history-popover" role="dialog" aria-label="操作历史">
          <div className="history-title">操作历史</div>
          <div className="history-list">
            {(mode === 'split' ? [...splitPast].reverse() : [...freePast].reverse()).map((h, idx) => (
              <button
                key={`${h.at}-${idx}`}
                type="button"
                className="history-item"
                onClick={() => {
                  if (mode === 'split') {
                    const past = [...splitPast];
                    const reverseIndex = splitPast.length - 1 - idx;
                    const target = past[reverseIndex];
                    const toFuture = past.slice(reverseIndex + 1).reverse();
                    const remainPast = past.slice(0, reverseIndex);

                    setSplitPast(remainPast);
                    setSplitFuture((prev) => [...toFuture, ...prev].slice(0, 60));
                    applySplit(target);
                    return;
                  }

                  const past = [...freePast];
                  const reverseIndex = freePast.length - 1 - idx;
                  const target = past[reverseIndex];
                  const toFuture = past.slice(reverseIndex + 1).reverse();
                  const remainPast = past.slice(0, reverseIndex);

                  setFreePast(remainPast);
                  setFreeFuture((prev) => [...toFuture, ...prev].slice(0, 60));
                  applyFree(target);
                }}
              >
                <span className="history-item-label">{h.label}</span>
                <span className="history-item-time">{new Date(h.at).toLocaleTimeString()}</span>
              </button>
            ))}
            {mode === 'split'
              ? splitPast.length === 0
                ? <div className="history-empty">暂无历史</div>
                : null
              : freePast.length === 0
                ? <div className="history-empty">暂无历史</div>
                : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
