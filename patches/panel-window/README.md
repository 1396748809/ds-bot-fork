# 面板独立窗口 · 主进程补丁

`ds-bot/` 插件里那个「在新窗口打开」按钮，要主进程配合才能真开一个窗口：页面的
`window.open` 归主进程管，只放行 `about:blank` 且是隐藏窗口；DSH 的 Host 又是独立的
Node 进程，插件侧够不到 `BrowserWindow`。所以这一小块只能打在 `app.asar` 里。

## 两处补丁

| 文件 | 追加到 | 作用 |
| --- | --- | --- |
| `main-append.js` | `src/main.mjs` 末尾 | `ds-bot:panel-window` 通道：新开一个 400×820 的窗口，加载主窗口当前地址加 `?ds-bot-window=panel&session=…`（沿用主窗口的 cookie，不碰 token），重复调用复用同一个窗口；每一步写 `userData/panel-window.log`，静默失败也能查 |
| `preload-append.js` | `src/preload.cjs` 末尾 | 给页面暴露 `window.dsBotPanel.open()` |

插件侧对应的读取方：`ds-bot/src/client/panel-window.js`（解析查询串、标记 document、铺满面板）。

## 怎么打

`asar-append.cjs` 只做一件事：把补丁片段追加到归档末尾，再**原地等长**改写头部 JSON
（删掉该条目的 `integrity` 换空间、末尾补空格），其余 2.8 万个文件的偏移一个都不动。
不用重建整个包，也不用装 `@electron/asar`。

```powershell
cd patches\panel-window

# 先看要发生什么（不写盘）
node asar-append.cjs src/main.mjs    main-append.js    --dry
node asar-append.cjs src/preload.cjs preload-append.js --dry

# 真打。默认是追加；已经打过的会直接报 ALREADY patched 跳过，重复跑没有副作用
node asar-append.cjs src/main.mjs    main-append.js
node asar-append.cjs src/preload.cjs preload-append.js
```

`--archive <path>` 指向别的安装位置（默认 `D:\DS Bot\resources\app.asar`，也可以用环境变量
`DSBOT_ASAR`）。`entry.offset` 必须写成**相对 base**（`base = 8 + readUInt32LE(4)`）；写成绝对的
字节位置会让条目全指到归档外面去。

## 升级后

DS Bot 升级会覆盖 `app.asar`，两处补丁一起失效：界面上的按钮还在（插件是 link 的），
点了没反应。重跑一次上面的命令即可。改动前的原包 `asar-append.cjs` 会自动备份到
`D:\backup\app.asar.before-append-<时间戳>.bak`，要退回直接拷回去。
