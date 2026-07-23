# 📚 作业管理器 (Homework Manager)

一个基于纯前端 + Supabase 的班级作业管理工具，支持多科目、锁定保护、公告发布及一键导出图片。

## ✨ 功能特点
- 📝 多科目作业增删改查与排序
- 🔒 作业项锁定（防止误删）
- ☁️ 支持 Supabase 云端同步与实时更新
- 🖼️ 一键导出作业清单
- 📢 班级公告编辑
- 📅 重要日期滚动提醒

## 🛠️ 技术栈
- 原生 HTML / CSS / JavaScript
- [Supabase](https://supabase.com/) (数据库与实时同步)
- [html2canvas](https://html2canvas.hertzen.com/) (图片导出)

## 🚀 快速开始
1. 克隆本项目或直接下载 `index.html`。
2. 在 Supabase 中创建一张名为 `class_data` 的数据表（参考数据表结构）。
3. 在 `设置` -> `绑定设置` 中填入你的 Supabase Project URL 和 anon/public Key。
4. 刷新页面即可开始使用。

## 📦 数据表结构 (Supabase)
```sql
-- 仅供参考
create table public.class_data (
  id uuid not null default gen_random_uuid (),
  bind_code text not null,
  class_name text not null,
  settings jsonb not null default '{}'::jsonb,
  homework_data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone null default now(),
  announcement text not null default ''::text,
  constraint class_data_pkey primary key (id),
  constraint class_data_bind_code_key unique (bind_code)
) TABLESPACE pg_default;
