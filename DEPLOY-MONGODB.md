# Railway + MongoDB Atlas（用 Compass 查看資料）

**Compass** 是桌面檢視工具；真正存資料的是 **MongoDB Atlas**。後端 API 連 Atlas，你再用 Compass 連同一條 URI 看 `daily`／`projects`／`uploads`。

## 安全（重要）

若連線字串曾貼到聊天／截圖，請立刻到 Atlas：

**Database Access → 該用戶 → Edit → Edit Password** 重設密碼，並更新 `.env`／Railway 變數。

**不要**把含密碼的 URI 提交到 git。

## Atlas 設定

1. Network Access → Add IP → 開發可暫用 `0.0.0.0/0`（Allow from anywhere）  
2. Database Access → 確認資料庫用戶可讀寫  
3. 複製連線字串：  
   `mongodb+srv://USER:PASSWORD@cluster0....mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

## 本機

根目錄建立 `.env`（已在 `.gitignore`）：

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0....mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGODB_DB=store_employee
PORT=8080
```

```bash
npm install
npm start
```

開 `http://localhost:8080/`，登入頁應顯示「已連接 MongoDB」。

Compass：New Connection → 貼同一條 `MONGODB_URI` → Connect  
資料庫 `store_employee` 內會有：

| Collection | 內容 |
|------------|------|
| `daily` | `_id: "main"` 每日工作 |
| `projects` | `_id: "main"` 項目／用戶／操作記錄 |
| `uploads.files` / `uploads.chunks` | GridFS 附件 |

## Railway

Variables：

| 變數 | 說明 |
|------|------|
| `MONGODB_URI` | Atlas 連線字串 |
| `MONGODB_DB` | 可選，預設 `store_employee` |

Deploy 後用 Railway 網域開啟前端。

## API（不變）

- `GET/PUT /api/daily`
- `GET/PUT /api/projects`
- `POST /api/files`、`GET /api/files/:id`
