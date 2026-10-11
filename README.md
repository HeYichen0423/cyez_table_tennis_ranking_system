# CYEZ 乒乓球积分系统

一个基于 Supabase（Auth + Postgres + RLS + Realtime）的校内乒乓球积分与赛事管理系统，
前端为纯静态页面，可直接部署到 GitHub Pages。

## 功能

- **积分排行榜**：按时间顺序回放全部“已生效”比赛，使用带权重与比分系数的 Elo 变体实时计算积分。
- **比赛录入**：选手提交本人参与的比赛，对手确认后计入积分；管理员/副管理员可为任意两人录入并直接生效。
- **历史记录 / 个人交战**：按选手筛选、查看两人交手战绩与积分变化。
- **赛事中心**：单败淘汰、双败淘汰、小组循环 + 淘汰赛，支持手动分组与签位。
- **留言板 / 通知**：支持 @ 提及、匿名发布、置顶与分页。
- **管理后台**：账号与角色管理、封禁、初始积分、密码重置、学生大名单导入、操作日志。

## 目录结构

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面骨架与各视图容器 |
| `styles.css` | 全部样式（含深色主题与响应式） |
| `rating-core.js` | 纯函数积分算法（被前端与测试共用） |
| `app.js` | 主应用逻辑：认证、数据加载、排行、留言板、管理后台 |
| `tournament.js` | 赛事与签位模块 |
| `supabase-config.js` | Supabase URL 与 Publishable / anon key |
| `supabase-schema.sql` | 数据库结构参考脚本 |
| `test/` | 单元测试（`node --test`） |

## 快速开始

```bash
npm install          # 仅测试需要；页面运行时从 CDN 加载依赖
# 编辑 supabase-config.js，填入你的 Supabase URL 与 anon key
npx serve .          # 或任意静态服务器，然后打开 index.html
```

`supabase-config.js` 中的 key 必须是 **Publishable / anon key**，绝不要放 Service Role Key。

## 数据库

首次部署按 `supabase-schema.sql` 建表、索引、触发器与 RLS 策略。注册第一个账号后，
在 SQL Editor 执行以下语句把自己设为管理员：

```sql
update public.profiles set role = 'admin' where username = '你的用户名';
```

> 注意：`register-student`、`admin-create-user`、`admin-reset-password`、
> `change-own-password`、`change-own-username` 等 Edge Functions 与部分 RPC
> 目前只在线上部署，未纳入本仓库，从零重建时请一并导出。

## 测试

积分算法是不依赖 DOM 的纯函数，可在 Node 中直接测试：

```bash
npm test
```

测试覆盖初始常量、比赛级别权重映射、`expectedScore` / `scoreMultiplier`、
`calculateDelta` 取整，以及 `replayRatings` 的零和性、时间顺序回放与权重覆盖。
