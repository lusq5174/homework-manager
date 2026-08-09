<div align="center">

# 作业管理器 Homework Manager

![Version](https://img.shields.io/badge/version-2.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-stable-brightgreen)

**一款轻量、高效、支持实时协作的班级作业管理工具**

[快速开始](#快速开始) · [功能特性](#功能特性) · [部署指南](#部署指南) · [技术文档](#技术架构)

</div>

---

## 项目简介

作业管理器（Homework Manager）是一款面向中小学班级场景的纯前端作业管理工具。它以单文件 HTML 应用的形式提供，无需复杂的后端部署，即可实现作业发布、预览、导出等核心功能，并可通过 Supabase 实现多端实时同步与班级协作。

本项目采用渐进式设计理念：核心功能零依赖运行，打开即用；云端同步为可选项，根据需求自行配置。单文件架构使得分发和部署变得极其简单，同时代码结构清晰，便于二次开发和功能扩展。

---

## 功能特性

### 作业管理

- **多科目分类**：支持语文、数学、英语、物理、化学、政治、历史、生物、地理、其他共 10 个科目分类，满足中小学全学科作业管理需求
- **作业项管理**：每个科目支持多个作业项，可通过上下移动按钮自由调整排序
- **多维属性**：每项作业支持内容描述、提交时间、预计耗时三个维度的信息录入
- **锁定机制**：重要作业可标记为锁定状态，防止误删和自动清理
- **快捷输入**：支持自定义快捷短语，一键插入常用作业描述，提升录入效率
- **提交时间快捷选项**：预置常用提交时间标签，点击即可填入

### 预览与导出

- **实时预览**：全部科目作业一览展示，清晰直观，支持实时刷新
- **图片导出**：基于 html2canvas 实现一键导出为高清 PNG 图片，方便转发至班级群
- **自定义样式**：可配置导出标题、字体大小、是否显示日期等参数
- **科目缩写优化**：导出时自动使用科目单字缩写，节省横向空间
- **自适应宽度**：导出图片宽度根据内容自动适配，避免留白过多

### 班级协作

- **本地模式**：数据存储于浏览器 LocalStorage，零依赖快速使用
- **云端同步**：通过 Supabase 后端实现多设备实时数据同步
- **绑定码加入**：使用绑定码快速加入班级，无需注册账号，降低使用门槛
- **多班级管理**：支持同时绑定多个班级，顶部下拉菜单一键切换
- **实时公告**：右侧公告栏支持实时编辑和同步，重要通知即时触达
- **Realtime 推送**：基于 Supabase Realtime 实现数据变更即时推送

### 个性化设置

- **班级设置**：班级名称、作业标题、导出字号、日期显示、自动清理等
- **快捷设置**：自定义快捷输入短语列表和提交时间快捷选项
- **重要日期**：支持添加考试、放假等重要日期，顶部导航栏自动倒计时显示，多日期轮播切换
- **每日自动清理**：可配置每日自动清理未锁定作业，保持界面整洁

---

## 技术栈

- **HTML + CSS + JavaScript（原生）**：前端页面与业务逻辑，无框架依赖，单文件架构
- **Supabase (PostgreSQL + Realtime)**：后端数据存储与实时同步服务
- **html2canvas**：DOM 转 Canvas，实现作业图片导出功能
- **LocalStorage API**：本地模式下的数据持久化存储

### 设计原则

- **零依赖运行**：核心功能不依赖任何外部服务，打开 HTML 文件即可使用
- **渐进式增强**：云端同步为可选功能，不配置不影响基础使用体验
- **单文件部署**：整个应用封装为单个 HTML 文件，便于分发、部署和版本管理
- **数据双轨制**：本地存储与云端存储并行，通过统一的数据层抽象切换

---

## 快速开始

### 方式一：本地直接使用

1. 下载 `index.html` 文件至本地
2. 双击文件，使用任意现代浏览器打开即可开始使用
3. 所有数据自动保存在当前浏览器的 LocalStorage 中

注意：本地模式下，数据仅存储于当前浏览器的当前域名下，清除浏览器数据或更换浏览器会导致数据丢失。建议定期使用导出功能备份重要数据。

### 方式二：部署到 Web 服务器

将 `index.html` 上传到任意静态文件托管服务即可：

```bash
# 使用 Python 快速启动本地服务器（开发测试用）
python3 -m http.server 8080

# 然后在浏览器访问 http://localhost:8080/index.html
```

支持的部署平台包括但不限于：GitHub Pages、Vercel、Netlify、Cloudflare Pages、阿里云 OSS、腾讯云 COS 等。

---

## 部署指南

### Supabase 配置（云端同步功能）

如需使用云端同步和班级协作功能，需要配置 Supabase 后端。以下为完整配置步骤：

#### 第一步：创建 Supabase 项目

1. 前往 [Supabase 官网](https://supabase.com/) 注册账号并创建新项目
2. 等待项目初始化完成（通常需要 1-2 分钟）
3. 在项目设置（Project Settings）中获取 **Project URL** 和 **anon public API Key**

#### 第二步：创建数据表

进入 SQL Editor，执行以下 SQL 语句创建 `class_data` 表：

```sql
create table public.class_data (
  id uuid not null default gen_random_uuid (),
  class_name text not null,
  bind_code text not null,
  settings jsonb not null default '{}'::jsonb,
  homework_data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone null default now(),
  announcement text not null default ''::text,
  constraint class_data_pkey primary key (id),
  constraint class_data_bind_code_key unique (bind_code)
) TABLESPACE pg_default;

-- 可选：启用行级安全，根据实际需求配置访问策略
alter table public.class_data enable row level security;
```

#### 第三步：启用 Realtime 订阅

1. 进入 Database → Replication 页面
2. 找到 **Realtime** 配置区域
3. 为 `class_data` 表启用 Realtime 订阅功能
4. 确保监听 UPDATE 事件（用于实时同步数据变更）

#### 第四步：配置每日自动清理

如需启用每日自动清理未锁定作业的功能，需要创建 PostgreSQL 函数并配置定时任务。

创建清理函数：

```sql
create or replace function public.clean_daily_homework()
returns void
language plpgsql
as $$
DECLARE
  rec RECORD;
  cleaned_data JSONB;
BEGIN
  FOR rec IN
    SELECT bind_code, settings, homework_data
    FROM class_data
    WHERE settings->>'autoDeleteDaily' = 'true'
  LOOP
    WITH subject_keys AS (
      SELECT key
      FROM jsonb_object_keys(rec.homework_data) AS key
    )
    SELECT jsonb_object_agg(
      sk.key,
      jsonb_build_object(
        'homeworks',
        COALESCE(
          (SELECT jsonb_agg(hw)
           FROM jsonb_array_elements(rec.homework_data->sk.key->'homeworks') AS hw
           WHERE hw->>'locked' = 'true'),
          '[]'::jsonb
        )
      )
    )
    INTO cleaned_data FROM subject_keys sk;

    UPDATE class_data
    SET homework_data = cleaned_data,
        updated_at = NOW()
    WHERE bind_code = rec.bind_code;
  END LOOP;
END;
$$;
```

配置定时任务：在 Supabase 的 Cron 功能中，设置每日 UTC 16:00（即北京时间 00:00）调用 `clean_daily_homework()` 函数。

#### 第五步：在应用中配置连接

1. 打开作业管理器网页，点击右上角「设置」按钮
2. 切换到「绑定设置」标签页
3. 填入之前获取的 Project URL 和 API Key
4. 输入班级绑定码，点击「添加班级」完成绑定

---

## 使用说明

### 基础操作流程

| 操作 | 步骤说明 |
|------|----------|
| 添加作业 | 左侧选择科目 → 点击「添加作业项」→ 填写作业内容、提交时间、预计耗时 |
| 保存作业 | 编辑完成后点击左侧「全部」栏目，自动触发保存 |
| 导出图片 | 在「全部」预览模式下，点击顶部「导出作业」按钮，自动下载 PNG 图片 |
| 快捷删除 | 点击顶部「快捷删除」，一键清空所有未锁定的作业项 |
| 切换班级 | 顶部下拉菜单选择目标班级，自动加载对应数据 |

### 锁定功能说明

- 每个作业项左侧提供锁定/解锁按钮
- 锁定状态的作业项会以橙色边框高亮显示
- 锁定的作业不会被「快捷删除」功能移除
- 锁定的作业不会被「每日自动清理」功能清除
- 删除锁定作业时需要二次确认，防止误操作

### 重要日期功能

1. 进入设置面板 → 切换到「重要日期」标签
2. 点击「添加重要日期」按钮
3. 填写日期名称（如"期中考试"）和具体日期
4. 顶部导航栏自动显示倒计时信息
5. 配置多个日期时，每 10 秒自动轮播切换
6. 已过期的日期显示为"已过去 N 天"

---

## 技术架构

### 整体架构

作业管理器采用前后端分离的架构设计，前端为纯单页应用，后端基于 Supabase 提供 BaaS（Backend as a Service）能力。

- 浏览器前端：UI 层（HTML/CSS） + 业务逻辑层（JS Core） + 数据层（Storage API）

- Supabase 后端：Supabase 数据库（PostgreSQL） + Realtime 订阅

### 核心模块划分

| 模块名称 | 功能描述 | 关键函数 |
|----------|----------|----------|
| 作业管理模块 | 作业项的增删改查、排序调整、锁定状态管理 | `addHomework()`, `deleteHomework()`, `toggleHomeworkLock()`, `moveHomeworkUp()` |
| 预览导出模块 | 作业预览渲染、图片导出生成、格式排版 | `updatePreview()`, `exportToImage()`, `generateExportContent()` |
| 数据存储模块 | 本地与云端数据读写、同步策略管理 | `saveData()`, `uploadHomeworkToSb()`, `fetchSbRow()`, `upsertSbRow()` |
| 实时同步模块 | Supabase Realtime 订阅建立、消息处理、状态同步 | `setupRealtime()`, `unsubscribeRealtime()` |
| 班级管理模块 | 多班级切换、绑定码验证、班级列表管理 | `onClassSelectChange()`, `bindNewClass()`, `removeBoundClass()` |
| 设置管理模块 | 全局设置与班级设置的读取、持久化、UI 同步 | `saveClassSettings()`, `saveGlobalSettings()`, `updateClassSettingsUI()` |
| 公告管理模块 | 公告内容的编辑、保存、同步展示 | `saveAnnouncement()`, `editAnnouncement()`, `loadAnnouncement()` |
| 重要日期模块 | 日期倒计时计算、轮播展示、动态更新 | `calculateDaysUntilImportantDate()`, `updateImportantDateDisplay()`, `checkAndStartScroll()` |

### 数据结构定义

#### 作业数据结构

作业数据按科目分组存储，每个科目下包含多个作业项：

```javascript
homeworkData = {
  "语文": {
    homeworks: [
      {
        content: "背诵课文第三段",    // 字符串，作业内容描述
        submitTime: "晚前",          // 字符串，提交时间标签
        estimatedTime: "20",        // 字符串，预计耗时（分钟）
        locked: false               // 布尔值，是否锁定
      }
    ]
  },
  "数学": { homeworks: [...] },
  // 其余科目结构相同
}
```

#### 班级设置结构

每个班级独立维护一套设置参数：

```javascript
classSettings = {
  className: "高三(1)班",        // 字符串，班级名称
  bindCode: "ABC123",            // 字符串，班级绑定码
  exportTitle: "今日作业",        // 字符串，导出图片标题
  exportAddDate: true,           // 布尔值，导出时是否添加日期
  exportFontSize: 30,            // 数字，导出字体大小（像素）
  autoDeleteDaily: true          // 布尔值，是否每日自动清理
}
```

#### 全局设置结构

全局设置在所有班级间共享：

```javascript
globalSettings = {
  shortcuts: ["补充", "学评", "小题", ...],    // 字符串数组，快捷输入短语
  timeOptions: ["晚前", "限时", "一", ...],    // 字符串数组，提交时间快捷选项
  importantDates: [                            // 对象数组，重要日期列表
    { name: "期中考试", date: "2024-11-15" }
  ]
}
```

---

## 运行逻辑与交互设计

### 程序初始化流程

应用启动时按以下顺序执行初始化：

1. **全局设置加载**：从 LocalStorage 读取全局设置（快捷短语、时间选项、重要日期），若无则使用默认值
2. **班级列表加载**：读取已绑定的班级列表和当前选中班级
3. **Supabase 客户端初始化**：检查是否配置了 Supabase 连接信息，若有则创建客户端实例
4. **作业数据初始化**：为所有科目创建空的作业数据结构
5. **当前班级数据加载**：根据当前班级类型（本地/云端）加载对应的作业数据和班级设置
6. **每日自动清理检查**：若为本地班级且启用了自动清理，检查今日是否已执行，未执行则执行清理
7. **UI 渲染**：渲染科目侧边栏、预览区域、公告栏、重要日期倒计时
8. **事件绑定**：绑定科目切换、设置面板、模态框交互等事件监听
9. **实时同步建立**：若为云端班级，建立 Supabase Realtime 订阅通道

### 作业编辑交互流程

用户在编辑模式下的交互逻辑：

1. 用户点击左侧科目栏选择具体科目，切换到编辑模式
2. 系统加载该科目的作业列表，渲染为可编辑的作业项
3. 用户点击「添加作业项」，在列表末尾追加一个空白作业项
4. 用户在文本框中输入作业内容，每次输入触发即时保存
5. 用户可通过上下箭头调整作业项顺序
6. 用户可点击锁定按钮标记重要作业
7. 用户点击「全部」返回预览模式，触发数据保存（本地写入 LocalStorage，云端写入 Supabase）
8. 若为云端班级，切换回预览模式后重新建立 Realtime 订阅

### 班级切换流程

多班级切换的完整流程：

1. 用户通过顶部下拉菜单选择目标班级
2. 系统断开当前班级的 Realtime 订阅（如为云端班级）
3. 更新当前班级标识并持久化到 LocalStorage
4. 显示加载状态，清空当前预览内容
5. 加载目标班级的设置数据和作业数据
6. 若为云端班级，建立新的 Realtime 订阅通道
7. 重新渲染预览界面和公告栏
8. 完成切换，恢复可交互状态

### 实时同步机制

云端班级的数据同步采用以下策略：

- **写入策略**：用户在编辑模式下的每次输入即时保存到本地内存；切换到「全部」预览模式时统一上传到 Supabase
- **读取策略**：班级切换时从 Supabase 拉取最新全量数据
- **推送策略**：通过 Supabase Realtime 订阅数据变更事件，收到推送后即时更新本地状态和 UI
- **冲突处理**：以服务端最新数据为准，本地未保存的编辑内容可能被覆盖（因此编辑模式下暂停 Realtime 订阅）

### 导出图片流程

导出功能的执行流程：

1. 用户点击「导出作业」按钮
2. 系统调用 `generateExportContent()` 生成导出专用的 DOM 结构
3. 将导出容器定位到屏幕外（避免影响用户界面），挂载到页面中
4. 等待 DOM 渲染完成（100ms 延迟确保样式生效）
5. 调用 html2canvas 将 DOM 转换为 Canvas，缩放比例为 2 倍以保证清晰度
6. 将 Canvas 转换为 PNG 格式的 DataURL
7. 创建临时下载链接，触发浏览器下载
8. 清理导出容器，恢复页面状态

---

## 项目结构

```
homework-manager/
├── index.html           # 主应用文件，包含全部 HTML、CSS、JavaScript
├── 使用须知.pdf          # 面向普通用户的使用须知文档
├── README.md            # 项目说明文档（本文件）
└── LICENSE              # 开源许可证文件
```

本项目采用单文件架构，所有 HTML 结构、CSS 样式、JavaScript 逻辑均包含在一个 HTML 文件中。这种设计的优势在于：

- 分发简单：只需传递一个文件即可完成应用部署
- 部署便捷：无需构建工具链，直接放到任意静态服务器即可运行
- 版本管理清晰：每个版本对应一个文件，便于回溯和对比
- 离线可用：文件下载后可完全离线使用（云端同步功能除外）

---

## 不足与展望

### 当前已实现的创新点

1. **单文件架构设计**：将完整的 Web 应用封装为单个 HTML 文件，极大降低了部署和分发门槛，适合校园场景下的快速传播
2. **双轨存储机制**：本地存储与云端存储并行，通过统一的存储适配器层抽象，实现无缝切换
3. **编辑/预览模式分离**：编辑模式下暂停实时同步，避免频繁写入和冲突；预览模式下开启同步，保证数据最新
4. **绑定码访问模式**：无需用户注册登录，通过绑定码即可加入班级，降低了使用门槛和隐私顾虑
5. **作业锁定机制**：引入锁定状态，配合每日自动清理，既保证了界面整洁，又避免了重要作业被误删
6. **重要日期轮播**：顶部导航栏的日期倒计时轮播，充分利用屏幕空间，提供仪式感和提醒功能

### 当前存在的不足

1. **多用户编辑冲突**：多人同时编辑同一班级作业时，后保存者会覆盖先保存者的内容，缺乏冲突合并机制
2. **离线编辑限制**：云端班级在离线状态下无法编辑作业，本地缓存能力较弱
3. **历史版本缺失**：没有作业数据的历史版本记录，误操作后无法回退到之前的状态
4. **移动端体验**：虽然有响应式设计，但在小屏设备上的编辑体验仍有优化空间
5. **数据导出格式单一**：仅支持 PNG 图片导出，缺少 PDF、文本等其他格式选项
6. **无用户体系**：基于绑定码的模式虽然便捷，但无法进行权限管理和操作审计

### 未来可创新方向

1. **冲突解决机制**：引入基于操作日志的冲突合并算法，实现多人协同编辑
2. **离线优先架构**：采用 IndexedDB 作为本地缓存，支持离线编辑，联网后自动同步
3. **版本历史功能**：记录每次数据变更，支持查看历史版本和一键回滚
4. **富文本支持**：作业内容支持富文本编辑，可插入图片、公式、链接等
5. **作业完成状态**：增加作业完成勾选功能，支持学生端查看和标记完成状态
6. **统计分析功能**：作业量统计、各科目作业时长分布、趋势图表等数据分析
7. **多语言支持**：国际化适配，支持中英文切换
8. **主题定制**：支持深色模式、自定义主题色等个性化外观设置
9. **API 开放**：提供开放 API，支持与其他系统（如教务系统）集成
10. **PWA 支持**：渐进式 Web 应用，支持添加到桌面、离线使用、推送通知等

---

## 贡献指南

欢迎提交 Issue 和 Pull Request 参与项目贡献。

### 开发环境

本项目无需复杂的构建工具链，直接使用文本编辑器修改 HTML 文件即可。推荐开发环境：

- 代码编辑器：VS Code（建议安装 Live Server 插件）
- 浏览器：Chrome / Firefox / Edge 等现代浏览器
- 调试工具：浏览器开发者工具

### 代码规范

- 使用原生 JavaScript，不引入额外的前端框架
- 函数命名采用 camelCase 风格，变量命名语义化
- 核心功能函数添加必要的注释说明
- 保持单文件架构，不拆分为多文件
- CSS 类名采用 BEM 或类似的命名规范，避免样式冲突
- 尽量使用原生 API，减少第三方依赖

### 提交规范

Git 提交信息建议遵循以下格式：

- `feat:` 新增功能
- `fix:` 修复 Bug
- `docs:` 文档更新
- `style:` 样式调整
- `refactor:` 代码重构
- `perf:` 性能优化
- `chore:` 构建/工具链调整

---

## 许可证

本项目采用 [MIT License](https://github.com/lusq5174/homework-manager/blob/main/LICENSE) 开源协议。

你可以自由地使用、复制、修改、合并、发布、分发、再许可和/或销售本软件的副本，以及允许向其提供本软件的人这样做，前提是在所有副本或软件的重要部分中包含上述版权声明和本许可声明。

---

## 致谢

- [Supabase](https://supabase.com/) - 提供强大的开源后端即服务平台
- [html2canvas](https://html2canvas.hertzen.com/) - 提供 DOM 转 Canvas 的能力
- 所有为本项目提交 Issue、贡献代码、提供反馈的用户

---

## 联系方式

- 问题反馈：欢迎通过 GitHub Issue 提交问题和建议
- 交流讨论：QQ 2302203772

---

<div align="center">

如果这个项目对你有帮助，欢迎给一个 Star 支持项目发展。

Made by 𝑙𝑢𝑠𝑞

</div>
