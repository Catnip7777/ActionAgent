# Action Agent Lite v3.10

> 让大模型直接读写你的本地文件、管理任务——无需后端，纯浏览器运行。

---

## 📦 简介

**Action Agent Lite** 是一个基于浏览器 File System Access API 的单页应用。授权一个文件夹，大模型就能在里面读写文件、创建目录、管理任务。纯前端，数据不出浏览器。

### 三步启动

1. 双击 `index.html`（无需服务器）
2. 配置 API 地址、Key、模型名称
3. 授权文件夹，开始对话

---

## ✨ 核心功能

### 📁 文件操作
- `write_file` / `append_file` — 创建和追加
- `edit_file` — 7种安全编辑（replaceAll/insertLines/removeLines 等）
- `list_dir` / `mkdir` / `delete_file`（需确认）

### 🧠 文件上下文池 ⭐
- 按需读取文件关键行，非一次性读完整份
- 带行号显示，AI 可直接引用
- 文件修改后自动标记过时，提示重新读取

### 📋 任务板
- `task_add` / `task_list` / `task_update` / `task_delete`
- `task_decompose` — 自动分解子任务
- `task_check` — 标记完成并附备注

---

## 📂 项目结构

```
index.html             主页面（双击打开）
action-*.js            动作定义
app-core.js            核心状态（配置/对话/上下文池/提示词）
app-executor.js        动作执行引擎
app-llm.js             LLM API 调用
app-chat-ui.js         对话界面
tasks.js               任务板
styles.css             样式
```

---

## 🆚 对比全功能版

| 特性 | Lite v3.10 | 全功能版 v3.0 |
|------|:----------:|:------------:|
| 文件上下文池 | ✅ 含 stale 标记 | ✅ |
| 任务板 | ✅ | ✅ |
| 编辑文件 | ✅ 7种操作 | ✅ 7种操作 |
| 纯浏览器 | ✅ 即开即用 | 可选后端 |
| 插件系统 | ❌ | ✅ |
| 持久记忆 | ❌ | ✅ |
| 统计面板 | ❌ | ✅ |
| 多工作区 | ❌ | ✅ |

---

## 📄 License

MIT
