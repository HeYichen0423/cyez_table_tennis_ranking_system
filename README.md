# CYEZ乒乓球积分系统

这是一个“GitHub Pages + Supabase”版本。前端仍然是静态网页，但账号、选手、比赛和管理员权限全部保存在 Supabase 云端，因此所有人打开同一个网址可以看到同一份实时数据。

## 功能

- CYEZ乒乓球积分系统主页
- 所有人初始 1500 分
- Elo 预期胜率 + 比分权重 + 比赛级别权重
- GitHub Pages 前端
- Supabase Auth 用户注册/登录
- 注册时填写真实姓名、用户名、密码
- 所有访客可以查看排行榜和已生效比赛
- 登录选手可以自己提交与自己有关的比赛
- 对手确认后，比赛才进入正式积分
- 待确认 / 已生效 / 已拒绝 / 已撤销状态
- 管理员和副管理员审核、撤销比赛
- 管理员可以封禁/解封账号
- 管理员可以把选手提升为副管理员，也可以取消副管理员
- 实时同步排行榜、比赛记录和账号状态
- 历史交战记录
- 个人交战记录
- 管理员操作日志
- 积分按当前“已生效比赛”按时间重新回放，因此撤销中间比赛后不会造成积分错乱

## 项目文件

```text
index.html
styles.css
app.js
supabase-config.js
supabase-schema.sql
README.md
```

## 一、创建 Supabase 项目

1. 注册 / 登录 Supabase。
2. 新建一个 Project。
3. 打开 SQL Editor。
4. 把本项目的 `supabase-schema.sql` 全部复制进去并执行。
5. 打开 Authentication 设置，允许新用户注册，并按本项目要求关闭 Confirm Email。否则用户名登录对应的虚拟邮箱无法直接进入系统。
6. 在 Project Settings / API 中找到 Project URL 和 Publishable key（旧项目可能显示 anon key）。
7. 打开 `supabase-config.js`，填写：

```js
window.CYEZ_SUPABASE_CONFIG = {
  url: 'https://你的项目.supabase.co',
  anonKey: '你的 Publishable / anon key'
};
```

不要把 `service_role` key 放到网页里。

## 二、建立第一个 admin

先通过网站注册你的管理员账号，例如用户名是 `admin`。

然后回到 Supabase SQL Editor 执行：

```sql
update public.profiles
set role = 'admin'
where username = 'admin';
```

重新登录后，顶部会出现“管理后台”。以后管理员可以在网站里把其他选手设置为“副管理员”。

## 三、GitHub Pages 部署

把以下文件放进 GitHub 仓库根目录：

```text
index.html
styles.css
app.js
supabase-config.js
supabase-schema.sql
README.md
```

然后进入：

```text
GitHub Repository
→ Settings
→ Pages
→ Build and deployment
→ Deploy from a branch
→ Branch: main
→ Folder: / (root)
→ Save
```

GitHub Pages 负责托管静态文件，Supabase 负责账号、数据库和实时同步。

## 四、登录机制说明

网站界面让用户填写“用户名 + 密码”，Supabase Auth 底层使用一个内部虚拟邮箱标识：

```text
用户名@login.cyez.local
```

普通用户看不到这个实现细节。

请注意：这种方案为了满足“只有真实姓名、用户名、密码”的报名界面，需要关闭 Email Confirmation。因此建议进一步打开 Supabase 的 CAPTCHA / Attack Protection，并严格使用强密码。

## 五、比赛确认机制

为避免任何人伪造他人比赛，普通选手不能随意给两个人写比赛。

提交条件：

- 提交者必须是本场比赛的 A 或 B 选手。
- 提交后进入“待对手确认”。
- 对手可以确认或拒绝。
- 两边之一提交 + 另一方确认后，比赛状态变成“已生效”。
- 只有“已生效”的比赛影响排行榜。
- 管理员 / 副管理员可以审核待处理比赛，也可以撤销已生效比赛。

## 六、积分算法

设胜者赛前积分为 `R_winner`，负者赛前积分为 `R_loser`：

```text
E = 1 / (1 + 10^((R_loser - R_winner)/400))

M = min(1.50,
        0.70 + 0.80 * ((W-L)/(W+L))^0.65
              * (ln(1+W+L)/ln(5))^0.35)

ΔR = 32 * C * M * (1-E)
```

比赛级别：

- 友谊赛：0.2
- 社团组织比赛：0.5
- 校级比赛预选赛：0.5
- 区赛 / 市赛预选赛：0.8
- 校级正式比赛：1.0

胜者增加 `ΔR`，负者减少 `ΔR`。

## 七、为什么撤销比赛不会把积分弄乱

网站不把某场比赛的“最终积分”永久写死在比赛行里，而是读取所有当前“已生效”的比赛，按比赛时间重新播放：

```text
1500
→ 第1场
→ 第2场
→ 第3场
→ …
```

管理员撤销中间一场比赛后，系统会自动按照剩余比赛重新计算全部积分。所以删除中间历史记录不会留下错误的后续积分。

如果管理员补录一场过去日期的比赛，也可能改变它之后比赛的积分结果。这是按“实际比赛时间”计算 Elo 的正常行为。

## 八、安全建议

- 永远不要把 Supabase `service_role` key 放进 GitHub Pages。
- 为 Supabase 项目启用 CAPTCHA / Attack Protection。
- 定期查看 Authentication 与数据库审计。
- 生产环境不要关闭真实身份校验后再允许用户随便冒充他人；当前系统采用“对手确认”降低伪造风险。
- 如需更高安全级别，可进一步加入校园邮箱 / 学号校验、管理员邀请制或短信/邮箱验证。
