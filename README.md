# LLM Action Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome](https://img.shields.io/badge/Chrome-86+-brightgreen)](https://www.google.com/chrome/)
[![Edge](https://img.shields.io/badge/Edge-90+-brightgreen)](https://www.microsoft.com/edge)

> 让大模型直接执行本地操作——读写文件、管理任务、操作目录。无需后端，纯浏览器运行。

## 📖 是什么

**Action Agent** 是一个基于浏览器 **File System Access API** 的单页 Web 应用。  
你授权一个文件夹，大模型就能在里面读写文件、创建目录、管理任务——就像有一个程序员小伙伴在你的电脑里工作。

### 核心理念

大模型的回复中嵌入标准化的「动作块」（JSON），浏览器解析并执行这些动作，结果回传给大模型，形成闭环。

### 一句话体验
双击 index.html → 配置 API Key → 授权文件夹 → 开始对话。

text

---

## ✨ 核心功能

### 📁 文件操作（核心能力）

| 动作 | 说明 |
|------|------|
| `write_file` | 创建或覆盖文件 |
| `append_file` | 向文件末尾追加内容 |
| `edit_file` | 7 种安全编辑操作（见下方） |
| `list_dir` | 列出目录内容 |
| `mkdir` | 创建目录 |
| `delete_file` | 删除文件（需用户确认） |

#### `edit_file` 的 7 种操作模式

| 模式 | 说明 |
|------|------|
| `replace` | 替换首个匹配的字符串 |
| `replaceAll` | 替换所有匹配（字符串匹配，非正则） |
| `replaceLines` | 替换指定行范围 |
| `insertLines` | 在指定位置插入内容 |
| `removeLines` | 删除指定行范围 |
| `prepend` | 在文件开头添加内容 |
| `append` | 在文件末尾追加内容 |

---

### 🧠 文件上下文池 ⭐

> v3.x 版本最具突破性的特性，改变了 AI 与文件的交互方式

- **按需读取**：不是一次性读完整份代码，通过 `add_file_to_context` 只读关键行
- **带行号引用**：上下文池中的文件显示行号，AI 可直接引用指定行
- **自动更新**：文件修改后自动同步到上下文池
- **范围读取**：支持 `{fromLine:10, toLine:30}` 只读取需要的部分
- **Stale 标记（v3.10 独有）**：文件修改后标记为过期，提示重新读取

**效果**：节省 Token、提升效率、更精准的代码引用。

---

### 📋 任务板

每个对话自带任务板，AI 自动将大任务拆解为子任务并逐步完成。

| 动作 | 说明 |
|------|------|
| `task_add` / `task_list` | 添加和查看任务 |
| `task_update` / `task_delete` | 更新和删除 |
| `task_decompose` | 将任务分解为子任务 |
| `task_check` | 标记完成并附检查备注 |

---

### 💬 对话特性

- **自动命名**：首轮回复后 AI 自动生成 ≤15 字标题
- **自动执行 + 回传确认**（可分别开关）
- 导出对话为 JSON
- 清空上下文（保留对话记录）
- 多轮协作：AI 逐步操作、反馈结果

---

## 🚀 快速开始

### 前置要求

- 浏览器：Chrome 86+ / Edge 90+（需要 File System Access API）
- API Key：OpenAI / DeepSeek / 通义千问 / Ollama 等兼容接口

### 三步启动

```bash
# 1. 下载项目，双击 index.html（无需服务器）
# 2. 在界面中配置 API 地址、Key、模型名称
# 3. 在「工作区」面板授权一个文件夹
第一个对话
输入：

text
帮我创建一个 hello.txt，里面写「你好，世界！」
你会看到：

AI 回复文字说明

自动弹出 <action_fix> 动作块

文件被创建

执行结果显示在回复下方

📦 版本体系
版本	定位	文件数	面板数	后端	适用场景
v2.2	全功能版起点	~22	10	server.py	插件/记忆/统计/日志全家桶
v3.0	全功能版升级	~22	9	server.py	文件上下文池 + 多工作区 + Token 统计
v3.6	轻量版起点	~17	3	有配置	3 面板极简 + 编码原则
v3.10 🏆	轻量版最终版	~17	3	纯浏览器	文件上下文池 + stale 标记 + 零配置
选择指南
你的需求	推荐版本
日常辅助编程，即开即用	v3.10 轻量版 🏆
多项目并行、需要统计面板	v3.0 全功能版
需要持久记忆和插件系统	v3.0 全功能版
需要操作本地任意文件	v3.0 全功能版 + server.py
学习研究最小实现	v3.10 轻量版
📂 项目结构（以 v3.10 为例）
text
index.html              ← 主页面（双击打开）
action-registry.js      ← 动作注册表
action-file.js          ← 文件操作
action-editfile.js      ← 文件编辑（7种安全操作）
action-browser.js       ← 浏览器操作（notify/clipboard/alert/download）
action-system.js        ← 系统操作
actions.js              ← 动作执行路由
app-core.js             ← 核心状态管理（配置/对话/上下文池/提示词）
app-format.js           ← 动作格式解析
app-executor.js         ← 动作执行引擎
app-llm.js              ← 大模型 API 调用
app-chat-ui.js          ← 对话界面
app-init.js             ← 启动初始化
app-worker.js           ← Web Worker（异步）
tasks.js                ← 任务板管理
styles.css              ← 样式
🔧 内置动作一览
类别	动作
文件操作	write_file append_file delete_file list_dir mkdir edit_file
上下文管理	add_file_to_context remove_file_to_context list_context_files
浏览器操作	notify clipboard open_url download local_storage alert
对话管理	rename_conversation
任务管理	task_add task_list task_update task_delete task_decompose task_check
🔒 安全特性
删除文件前弹出确认框，需手动确认

工作区可设为「只读」，AI 无法修改文件

危险操作（delete_file）执行前需用户确认

所有数据仅存于浏览器 localStorage + IndexedDB

纯前端，数据不出浏览器（轻量版）

💾 数据存储
类型	方式
API 配置	浏览器 localStorage
对话记录	localStorage + IndexedDB 双重写入
授权文件夹	浏览器 File System Access API 临时授权
统计数据（全功能版）	localStorage
🆚 全功能版 vs 轻量版
特性	轻量版 v3.10	全功能版 v3.0
文件上下文池	✅ 含 stale 标记	✅
按行读取	✅ fromLine/toLine	✅ fromLine/toLine
自动更新	✅ onContextFileWritten	✅ onContextFileWritten
任务板	✅	✅
edit_file 7种操作	✅	✅
纯浏览器即开即用	✅	可选 server.py
插件系统	❌	✅
持久记忆	❌	✅
统计面板 (Chart.js)	❌	✅
多工作区手柄	❌	✅
对话级 Token 统计	✅ 基础统计	✅ 含缓存命中率
手动动作面板	❌	✅
📈 升级路径
text
全功能版：  v2.2 ———→ v3.0
              │           │
              │      + 文件上下文池
              │      + 多工作区手柄
              │      + 对话级 Token 统计
              │      + edit_file 动作
              │      - 日志面板
              │
轻量版：    v3.6 ———→ v3.10（推荐 🏆）
                      │
                 + 文件上下文池
                 + stale 标记（独有）
                 - 后端依赖（纯浏览器）
                 - 附加工具栏
                 + 改进的编码原则
📝 编码原则（v3.10）
根据文件上下文或读取少量关键文件即可理解任务

找到问题或需要修改的地方

全面考虑，设计合理实现

分析探讨不动手，否则直接修改

代码审查保证正确性

完成后说明修改内容和方式

🌐 浏览器兼容
浏览器	支持情况
Chrome 86+	✅ 完整支持
Edge 90+	✅ 完整支持（v3.10 额外兼容 Edge 88-92）
Opera 72+	✅ 完整支持
Firefox	❌ 不支持 File System Access API
Safari	❌ 不支持 File System Access API
📄 License
MIT

一句话总结：Action Agent 让大模型成为你的本地文件操作助手——双击运行、授权文件夹、开始对话。日常用 v3.10 轻量版，重度用 v3.0 全功能版。
