# DS Bot · 0.3.9 自建补丁版

> A patched fork of [DS Bot](https://github.com/Fei-Craft/DS-Bot), staying on v0.3.9 with four fixes cherry-picked back from 0.3.10.
>
> 上游项目是 [Fei-Craft/DS-Bot](https://github.com/Fei-Craft/DS-Bot)。**这个仓库不是 DS Bot 的新版本，也不是官方分支**，是一份「停在 0.3.9、但把四个实际踩到的问题修掉」的存档。

---

## 这是什么

上游 DS Bot 的 `v0.3.9`（提交 `881b57b5`）之上叠了四个补丁，全部是我们自己在日常使用里撞出来的问题，每个都配了回归测试。

| 提交 | 修掉的问题 |
| --- | --- |
| `7cb8c35c` | 新建 Bot 时问候链失败会连累整组 |
| `e3d4d678` | 等模型响应失败时，问候根本发不出去 |
| `3d3274ae` | `bot_recall` 每次搜索都重新解析全部记忆文件 |
| `797cd698` | 普通 Bot 也带着四个团队管理工具，白占上下文 |

## 为什么停在 0.3.9

0.3.10 最大的改动是**移除并行会话**（revert #1548），但它的收尾提交没做完——`d29d2e84`（退休被撤销的并行 part）、`8b5c0bd0`（lock takeover 时不要乱提版本）、`86ee0790`（加固 legacy `openParts` 退休）都还挂在那之后。

实测 0.3.10 上并行会话会冲突、会假死。所以我们没有升级，改为把 0.3.10 里真正想要的三项改动摘回 0.3.9。

**如果你不需要这四个补丁，请直接用上游**。这个仓库的价值只在于这四处 diff。

## 四个补丁分别解决什么

### 1. `7cb8c35c` — 新建 Bot 的问候链失败不再拖垮整组

创建 Bot 时会走一条问候链。这条链抛异常时，异常会冒到创建流程外面，导致新建失败甚至连带影响其它 Bot。这里把它收敛成「问候失败只是问候失败」。

改动：`ds-bot/src/host/roster.js` +3 行，`ds-bot/test/roster.test.js` 新增一个用例。

### 2. `e3d4d678` — 等模型失败也把问候发出去

问候要等模型生成，模型超时或报错时整条问候就没了。改成先落一条问候消息，再等模型；模型失败时用户至少能看到 Bot 已经建好。

改动：`roster.js` 10 行，测试同步调整。

### 3. `3d3274ae` — `bot_recall` 复用已解析的记忆

`bot_recall` 每次搜索都把磁盘上的记忆文件整个重新解析一遍，团队记忆变大以后这一下很慢。改为解析结果复用，搜索路径只读缓存。

改动：`ds-bot/src/host/memory.js`（57 行），`memory.test.js` 新增用例。

### 4. `797cd698` — 四个团队管理工具只挂 Main Bot

`create_bot` / `stop_bot` / `create_group` / `delete_group` 四个工具此前每个 Bot 都带着，普通 Bot 根本调不了，纯粹是每回合多付一份 schema 钱。改成只在 Main Bot 的作用域里注册。

**这里有一个刻意的设计取舍**：身份识别不出来时，**按 Main 处理**（fail open），而不是按普通 Bot 处理。

原因是我们看过上游的同类实现翻车：0.3.10 的 `builtin-packs.js` 用「回合开始时冻结的角色」判断，结果出现过 Main Bot 自己也拿不到这四个工具的情况——主会话和后台任务会话都缺（上游 issue #2107），对话换段之后也会消失（#2178）。我们的实现不做冻结判断，认不出身份就宁可多给，所以换段之后照常可用。

改动：`ds-bot/src/host/tools.js`（30 行），`scoped-tools-creation.test.js` 新增用例。

## 怎么装上自己的 DS Bot

前提：DS Bot 桌面版 **0.3.9**（DSH `0.2.2-rc.1`）。换别的版本不保证对得上。

```bash
git clone https://github.com/1396748809/ds-bot-fork.git
```

然后编辑 `%USERPROFILE%\.ds-bot\profiles\ds-bot\package.json`，在 `dependencies` 里把它挂成本地链接：

```json
"ds-bot": "link:D:/path/to/ds-bot-fork/ds-bot"
```

在该目录下跑 `pnpm install`，然后重启 DS Bot。

**启动时会弹一个提示**，说装了一份旧插件、会盖过应用自带的新版，按钮是「移除它」/「仍要继续」——点**仍要继续**。原因就是上面这个 link：`profiles` 里装的 `ds-bot` 会遮蔽 `app.asar` 里内置的那一份，而两边版本其实相同（都是 0.3.9）。

回滚：把 `package.json` 改回去、重新 `pnpm install` 即可。

## 验证

```bash
cd ds-bot/dev/harness && npm install   # 首次：装 DSH 依赖
cd ds-bot && node --test test/roster.test.js test/memory.test.js
```

期望 **210 个用例全过**。

`test/scoped-tools-creation.test.js` 在部分机器上有 4 条与本补丁无关的失败（多出一个 `read_browser`、client channel 超时），属环境差异；判据是**改动前后失败清单完全一致**。

## 分支结构

- `our-main`（默认分支）— 补丁分支，本文描述的就是它
- `main` — 上游镜像，用来对照和取 diff

和上游对账：`git diff v0.3.9..our-main` 就是全部改动，只有 6 个文件。

上游若发布新版本，**不要直接 rebase**——0.3.10 之后的并行会话移除会影响上下文结构，需要先把四个补丁按新基线重打一遍再评估。

## 许可与归属

Apache License 2.0，见 [LICENSE](LICENSE)，原始版权归上游作者所有（[Fei-Craft/DS-Bot](https://github.com/Fei-Craft/DS-Bot)），`NOTICE` 原样保留。

本仓库新增的四个提交同样以 Apache-2.0 提供。
