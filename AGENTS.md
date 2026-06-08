# AGENTS.md

## コマンド

| コマンド | 説明 |
| --- | --- |
| `pnpm dev` | Vite 開発サーバーを起動 |
| `pnpm d` | Netlify 開発サーバーを起動（functions + プロキシ含む） |
| `pnpm build` | 型チェック (`tsc -b`) の後、本番ビルド (`vite build`) |
| `pnpm lint` | Biome によるチェック（lint + フォーマット） |
| `pnpm format` | Biome による自動修正 |
| `pnpm preview` | 本番ビルドをローカルでプレビュー |

コミット前に `pnpm build` を実行し、型とビルドが通ることを確認してください。CI では `pnpm lint && pnpm build` が実行されます。

## 技術スタック

- **React 19** + React Compiler（babel プラグインによる自動メモ化）
- **Vite 8**（ビルドツール）、**TypeScript 6.0**（~6.0.2、strict モード、`verbatimModuleSyntax`、`erasableSyntaxOnly`）
- **SWR 2**（データフェッチ） — すべての読み取り操作で `useSWR` を使用し、`revalidateIfStale: false`、`revalidateOnFocus: false`、`revalidateOnReconnect: false` を設定
- **react-router-dom 7**（BrowserRouter、コンポーネントベースの `<Routes>/<Route>`）
- **Tailwind CSS 4**（ユーティリティクラスのみ、CSS Modules 不使用）
- **Biome 2**（タブ、ダブルクォート、推奨 lint ルール）
- **pnpm**（パッケージマネージャ）
- **Netlify**（デプロイ、OAuth コールバック用の単一サーバーレス関数）

## アーキテクチャ

```plain
BrowserRouter
└── AnnictSessionProvider（認証コンテキスト: accessToken, viewer, login/logout）
    └── AppShell（レイアウト + ルーティング）
        ├── RouteMemory（PWA ルート永続化、非表示）
        ├── AppHeader（ロゴ、GlobalSearch、AnnictAccountControl）
        └── <Routes>
            ├── "/" → HomePage → SyobocalCalendar
            ├── "/works/:annictId" → WorkPage
            └── "*" → Navigate to "/"
```

### 主要コンポーネント

- **SyobocalCalendar** — テレビ番組表タイムライン。Syobocal JSON API から取得し、チャンネルディレクトリと統合して、クラスタリングと現在時刻線を含むビジュアルタイムラインを描画。カテゴリ、チャンネルグループ、再放送フィルタに対応。Annict 連携で視聴中作品をハイライト表示。
- **WorkPage** — Annict 作品詳細 + エピソード記録。作品情報、エピソード一覧、ステータス選択、レーティング/コメント付き記録フォームを表示。
- **AnnictSessionProvider** — OAuth トークン管理。トークンは `localStorage` に保存（`tamate.annict.accessToken`）。SWR でビューアプロファイルを取得し、401 を検出して自動クリア。
- **RouteMemory** — PWA スタンドアロンモード復元のため、最後に表示したパスを `localStorage` に読み書き。

### データフロー

**認証**: ログインで Annict OAuth にリダイレクト → Netlify function が認可コードをトークンと交換 → HTML ページが localStorage にトークンを設定 → 元のページにリダイレクト。

**データ取得**: すべての読み取り API で `useSWR(key, fetcher, { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false })` を使用。キーは配列タプル: `["prefix", ...params]`。条件付き取得は `null` キーで制御。手動の無効化は `mutate()` で、楽観的更新は `mutate(data)` で行う。

**コンポーネント間通信**: カスタム DOM イベント（`tamate:set-search-term`）を使って SyobocalCalendar から AppHeader の検索バーに検索語を渡す。

## コード規約

### TypeScript

- 型のみのインポートには `import type` を使用（`verbatimModuleSyntax: true`）
- インライン型インポートも可: `import { type Foo, bar } from "..."`
- enum 禁止（`erasableSyntaxOnly: true`）; `const` オブジェクト + Union 型で代用
- `src/lib/` のファイルは関数とその型の両方をエクスポート

### ファイル構成

- `src/lib/` — API クライアント、データアクセス、ユーティリティ関数（React 非依存）
- `src/components/` — React コンポーネント（1ファイルに1コンポーネント、またはコンテキスト+フックのペア）
- `src/shared/` — 定数および横断的ユーティリティ
- `netlify/functions/` — サーバーレス関数

### 命名規則

- コンポーネント: `PascalCase`、ファイル名はデフォルトエクスポート名と一致
- ライブラリモジュール: `camelCase`（annict.ts、syobocal.ts）
- 定数: `UPPER_SNAKE_CASE`
- コンテキスト + フック: `{Name}Provider` コンポーネント + `use{Name}()` フック
- ストレージキー: `tamate.` プレフィックス、ドット区切り
- SWR キー: 文字列プレフィックスを第一要素とする配列タプル

### React パターン

- 関数コンポーネントのみ
- コンテキスト + カスタムフックパターン（Provider 外で使用すると `throw`）
- ナビゲーションには `startTransition` を使用
- 検索のデバウンスには `useDeferredValue` を使用
- サーバー状態は SWR で管理、`useState` は UI 状態のみに使用
- SWR の `mutate(data, { revalidate: false })` で楽観的更新
- Biome がフォーマットを管理（タブ、ダブルクォート）— コミット前に `pnpm format` を実行

### スタイリング

- Tailwind ユーティリティクラスのみ（CSS Modules、styled-components 不使用）
- ダークテーマ: gray-900/950 背景、gray-100 テキスト
- ブランドカラー: `#FF8B46`（オレンジ）
- レスポンシブ: `max-[720px]`、`max-[1279px]`、`md:`、`xl:`

## API レイヤー

### Annict (`src/lib/annict.ts`)

- GraphQL: `requestAnnictGraphQL<T>(accessToken, query, variables?)` — `api.annict.com/graphql` に POST
- REST: `requestAnnictRest<T>(accessToken, path)` — `api.annict.com` に GET
- カスタムエラー: `AnnictApiError`（オプションの `status` フィールド付き）
- ヘルパー: `compact()` は null の配列要素を除去、`normalizeOptionalString()` は空文字をトリム

### Syobocal (`src/lib/syobocal.ts`)

- JSON エンドポイント: `/cal/json.php`（Netlify 経由で `cal.syoboi.jp` にプロキシ）
- XML エンドポイント: `/cal/db.php`（プロキシ）
- チャンネルディレクトリを localStorage に 31 日 TTL でキャッシュ
- 営業日: 日本のテレビ番組表は午前 4 時を日付境界とする（`getInitialSyobocalDate()`）
- 重複排除: `pendingScheduleRequests` Map で同一日付の並行取得を防止

### ストレージ (`src/lib/storage.ts`)

- 安全な localStorage ラッパー: `readStorage`、`writeStorage`、`removeStorage`
- キーは `src/shared/constants.ts` で定義（`STORAGE_KEYS`）
- PWA 検出用 `isStandaloneDisplayMode()`

### エラー (`src/lib/errors.ts`)

- `getErrorMessage(error)` — 任意のエラー型からメッセージ文字列を抽出
- `isUnauthorizedError(error)` — 401/403 パターンをチェック

## 環境変数

| 変数 | クライアント | Function | 用途 |
| --- | --- | --- | --- |
| `VITE_ANNICT_CLIENT_ID` | あり | あり | Annict OAuth クライアント ID |
| `ANNICT_CLIENT_SECRET` | なし | あり | Annict OAuth クライアントシークレット |

## Netlify プロキシ

`netlify.toml` により `/cal/db.php` と `/cal/json.php` が `https://cal.syoboi.jp/` にプロキシされます。Syobocal API に完全にアクセスするローカル開発では、`pnpm dev` ではなく `pnpm d`（Netlify dev）を使用してください。
