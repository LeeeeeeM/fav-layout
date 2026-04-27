# fav-layout

Go + React + TypeScript 的摸鱼布局小工具（后端：Go + GORM + PostgreSQL）。

## 功能

- 基础登录验证（默认账号：`admin / admin123`）
- 输入 B 站视频链接，回车快速添加 iframe 视频窗口
- 拖拽 + 缩放视频窗口
- 自动保存布局到后端，下次登录自动恢复

## 目录结构

- `backend`: Go API 服务（鉴权、布局存储）
- `frontend`: React + TS 页面

## 启动

### 0) 启动 PostgreSQL

```bash
cd /Users/sunliangmu/fav-layout
docker compose up -d postgres
```

默认数据库连接：`postgres://fav:fav@localhost:5433/fav_layout?sslmode=disable`

### 1) 后端

```bash
cd /Users/sunliangmu/fav-layout/backend
cp .env.example .env # 可选
go run ./cmd/server
```

默认监听 `http://localhost:8383`。

也可以用 air 热更新：

```bash
cd /Users/sunliangmu/fav-layout/backend
./dev.sh
```

### 2) 前端

```bash
cd /Users/sunliangmu/fav-layout/frontend
npm install
npm run dev
```

默认监听 `http://localhost:5173`。

## 可识别链接

- `https://www.bilibili.com/video/BV...`
- `https://www.bilibili.com/video/av...`
- `https://player.bilibili.com/player.html?...`（直接嵌入链接）

> 说明：某些短链（如 `b23.tv`）前端无法离线解析到 BV 号，建议先打开后复制最终视频链接。
