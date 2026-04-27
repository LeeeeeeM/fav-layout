export type User = {
  id: number;
  username: string;
};

export type Widget = {
  id: string;
  title: string;
  inputUrl: string;
  embedUrl: string;
  coverUrl?: string;
  upName?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SplitDirection = 'row' | 'col';

export type SplitLeaf = {
  kind: 'leaf';
  id: string;
  widget?: Widget;
};

export type SplitBranch = {
  kind: 'branch';
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: SplitNode;
  second: SplitNode;
};

export type SplitNode = SplitLeaf | SplitBranch;

export type WorkspaceMode = 'free' | 'split';

export type LayoutPayload = {
  items: Widget[];
  library: Widget[];
  mode: WorkspaceMode;
  splitRoot: SplitNode;
};
