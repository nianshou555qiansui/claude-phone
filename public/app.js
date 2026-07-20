/* Claude Phone Chat — mobile UI v2 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /** 轻量垃圾桶图标（会话/自定义模型删除） */
  const ICON_TRASH =
    '<svg class="icon-trash" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const ICON_CHECK =
    '<svg class="icon-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';

  /* ── i18n + theme ───────────────────────────────────── */
  const I18N = {
    zh: {
      'common.close': '关闭',
      'common.menu': '菜单',
      'common.delete': '删除',
      'common.deleteAria': '删除对话',
      'common.you': '你',
      'common.claude': 'Claude',
      'common.loading': '加载中…',
      'common.justNow': '刚刚',
      'common.secAgo': '{n}秒前',
      'common.minAgo': '{n}分钟前',
      'common.hrAgo': '{n}小时前',
      'common.dayAgo': '{n}天前',
      'common.reqTimeout': '请求超时',
      'sidebar.title': '对话',
      'sidebar.newChat': '＋ 新对话',
      'sidebar.import': '⬇ 导入本机会话',
      'sidebar.foot':
        '输入 <code>/help</code> 查看命令<br/><code>/resume</code> 导入本机 CLI 会话<br/><code>/rewind</code> 回退上一轮',
      'sidebar.empty': '暂无对话',
      'status.ready': '准备就绪',
      'status.running': '生成中…',
      'status.runningBg': '后台任务运行中…',
      'status.opening': '打开中…',
      'status.openFailed': '打开失败',
      'status.loadingChat': '加载中…',
      'chat.defaultTitle': '对话',
      'chat.emptyTitle': 'Claude Phone',
      'chat.emptyBody':
        '手机聊天驱动本机 Claude Code<br/>历史可上下滑 · 支持中转 · Markdown',
      'chat.emptyHints':
        '右上角 <b>/</b> 命令 · <b>⚙</b> 中转/API · 模型芯片<br/><code>/rewind</code> 回退 · 权限芯片 ≈ Shift+Tab<br/><b>后台任务</b>：勾选=关网页继续；不勾选=断开约4秒后停止',
      'model.pickTitle': '选择模型',
      'model.sheetTitle': '选择模型',
      'model.sheetSub': '当前默认与会话覆盖',
      'model.searchPh': '搜索模型 / 别名…',
      'model.scopeAria': '作用范围',
      'model.scopeSession': '仅本会话',
      'model.scopeDefault': '设为默认',
      'model.listAria': '模型列表',
      'model.addCustom': '添加自定义模型',
      'model.customIdPh': '模型 ID（中转实际名称）',
      'model.customLabelPh': '显示名称（可选）',
      'model.addBtn': '添加',
      'model.sessionOverride': '本会话覆盖',
      'model.globalDefault': '全局默认',
      'model.subSession': '本会话: {s} · 默认: {d}',
      'model.subDefault': '全局默认: {d}',
      'model.loadFail': '加载模型失败',
      'model.groupAlias': 'Claude 别名',
      'model.groupMapped': '已映射 / 环境',
      'model.groupCustom': '自定义',
      'model.empty': '没有匹配的模型<br/>可在下方添加自定义 ID',
      'model.delCustom': '删除此自定义模型',
      'model.selectedMark': '已选',
      'model.busySwitch': '生成中，请结束后再切换本会话模型',
      'model.switching': '切换中…',
      'model.switched': '模型已切换为 {m}（{scope}）· 下一条消息生效',
      'model.scopeSessionLabel': '本会话',
      'model.scopeDefaultLabel': '全局默认',
      'model.savedDefault': '已写入 settings.model，新对话默认使用',
      'model.savedSession': '仅本会话有效，不影响全局默认',
      'model.busyRetry': '忙碌中，稍后再试',
      'model.switchFail': '切换失败',
      'model.needId': '请填写模型 ID',
      'model.idTooLong': '模型 ID 过长（最多 200）',
      'model.added': '已添加，点选即可使用',
      'model.addFail': '添加失败',
      'model.delConfirm': '删除自定义模型 {id}？',
      'model.delFail': '删除失败',
      'resume.sheetTitle': '导入本机会话',
      'resume.sheetSub':
        '扫描 ~/.claude/projects · 打开时自动增量同步 · 可点「同步」强制刷新',
      'resume.searchPh': '搜索标题 / 目录 / 预览…',
      'resume.listAria': '本机会话列表',
      'resume.scanning': '扫描本机会话中…',
      'resume.count': '共 {n} 条本机 CLI 会话 · 点选后 --resume',
      'resume.hintOk': '点选导入；已在网页的会直接跳转',
      'resume.hintEmpty': '没有找到可导入的 CLI 会话',
      'resume.scanFail': '扫描失败',
      'resume.noMatch': '没有匹配的会话',
      'resume.badgeInWeb': '已在网页',
      'resume.badgeHistory': '历史导入',
      'resume.badgeCli': '本机 CLI',
      'resume.unknownDir': '（未知目录）',
      'resume.sync': '同步',
      'resume.syncTitle': '从 CLI 重新同步历史',
      'resume.markOpen': '打开',
      'resume.markHistory': '历史',
      'resume.markImport': '导入',
      'resume.hintInteractive':
        '交互式会话：导入历史气泡，网页侧用历史注入续聊（不能 --resume）',
      'resume.hintOpen': '已在网页 · 点击打开',
      'resume.hintResume': '可 --resume 继续',
      'resume.historyOnly': ' · 仅历史',
      'resume.opening': '打开已有对话…',
      'resume.importing': '导入中…',
      'resume.switched': '已切换到绑定该 CLI 会话的网页对话',
      'resume.syncedN': '已同步 {n} 条新消息',
      'resume.truncated': '（已截断）',
      'resume.nextResume': ' · 下一条 --resume 继续',
      'resume.importedN': '已导入 {n} 条历史',
      'resume.openedFresh': '已打开（含 {n} 条历史，已是最新）',
      'resume.alreadyOpen': '该会话已存在，已打开',
      'resume.noText': '已导入（transcript 无可展示文本）· 下一条 --resume 继续',
      'resume.imported': '已导入 · 下一条消息将 --resume 继续',
      'resume.noFile': '（未在本机找到 jsonl，resume 可能失败）',
      'resume.badResp': '导入响应异常',
      'resume.importingWait': '正在导入，请稍候',
      'resume.importFail': '导入失败',
      'resume.syncing': '同步中…',
      'resume.syncFail': '同步失败',
      'cmd.title': '命令',
      'cmd.aria': '命令',
      'cmd.panelTitle': '命令',
      'cmd.panelHint': '点选或输入 /help',
      'cmd.empty': '输入 /help',
      'cmd.noMatch': '无匹配命令 · 回车仍可发送',
      'mode.chipTitle': '权限模式（类似 Shift+Tab）',
      'mode.panelTitle': '权限模式',
      'mode.panelHint': '类似电脑 Shift+Tab',
      'mode.set': '权限已设为 {m} · 下一条消息生效',
      'mode.switchFail': '切换失败',
      'settings.title': 'API / 中转设置',
      'settings.aria': '设置',
      'settings.panelTitle': 'API / 中转设置',
      'settings.rawSummary': '高级：整份 settings.json',
      'settings.reload': '重载',
      'settings.save': '保存',
      'settings.loading': '加载中…',
      'settings.loadFail': '加载失败',
      'settings.readFail': '无法读取 settings',
      'settings.setHint': '已设置（留空=不修改；填 __CLEAR__ 删除）',
      'settings.unset': '未设置',
      'settings.rawNote':
        '（保存时若填写下方 JSON，将整份覆盖 settings.json。密钥请用上方字段改。）',
      'settings.saving': '保存中…',
      'settings.rawInvalid': 'raw JSON 无效:',
      'settings.saved':
        '已保存。新开的对话轮次会读到新配置（进行中的任务仍用旧进程环境）。',
      'settings.saveFail': '保存失败',
      'hud.aria': '会话状态',
      'hud.model': '当前模型',
      'hud.mode': '权限模式',
      'hud.duration': '本会话时长',
      'hud.context': '上下文占用（上一轮 usage 估算）',
      'hud.modelPrefix': '模型: ',
      'hud.modePrefix': '权限模式: ',
      'hud.durationPrefix': '本会话已进行 ',
      'hud.contextEmpty': '上下文：发过一轮后显示（来自 CLI usage）',
      'composer.bgTitle':
        '勾选：关网页也继续跑。不勾选：关网页约4秒后自动停止',
      'composer.bgLabel': '后台任务',
      'composer.jobPill': '后台运行中',
      'composer.jobPillLong': '后台运行中 · 可关网页',
      'composer.placeholder': '发给 Claude… 输入 / 打开命令',
      'composer.send': '发送',
      'composer.stop': '停止',
      'action.rewindTo': '回退到此之前',
      'action.rewindLast': '回退本轮 /rewind',
      'md.copy': '复制',
      'md.copied': '已复制',
      'md.copyFail': '失败',
      'theme.system': '跟随系统',
      'theme.light': '浅色',
      'theme.dark': '夜间',
      'theme.cycleTip': '主题：{m}（点击切换）',
      'lang.zh': '中文',
      'lang.en': 'EN',
      'lang.cycleTip': '语言：{m}（点击切换）',
      'mode.label.default': '默认',
      'mode.label.acceptEdits': '接受编辑',
      'mode.label.plan': '仅计划',
      'mode.label.auto': '自动',
      'mode.label.bypassPermissions': '全部放行',
      'mode.label.dontAsk': '仅白名单',
      'mode.label.manual': '默认',
      'mode.hint.default':
        '非交互默认：未在 allow 列表的工具会被拒或受限；网页无法弹窗点确认',
      'mode.hint.acceptEdits': '自动接受工作区内文件编辑与常见文件系统命令',
      'mode.hint.plan': '只读探索，不改源码（适合先想方案）',
      'mode.hint.auto': '自动模式（需 CLI 支持；否则可能失败）',
      'mode.hint.bypassPermissions': '跳过权限提示（危险，仅限自己服务器）',
      'mode.hint.dontAsk': '未在 permissions.allow 里的工具一律拒绝',
      'mode.hint.manual': '同默认（-p 下无法真正手动点确认）',
      'cmd.summary.help': '显示可用命令',
      'cmd.summary.rewind': '回退对话：/rewind 或 /rewind 1（回退 N 个用户回合）',
      'cmd.summary.clear': '清空当前对话上下文（保留会话壳）',
      'cmd.summary.compact': '压缩：本地丢弃过早消息，只保留最近若干轮',
      'cmd.summary.status': '显示当前会话状态（模式/目录/是否可 resume）',
      'cmd.summary.mode':
        '切换权限：/mode acceptEdits|plan|default|dontAsk|bypassPermissions',
      'cmd.summary.cwd': '查看或切换工作目录：/cwd 或 /cwd /path',
      'cmd.summary.model': '打开模型选择器（或 /model <id> 指定）',
      'cmd.summary.resume': '导入本机 CLI 会话（扫 ~/.claude/projects，--resume 继续）',
      'cmd.summary.sync': '从 CLI transcript 增量同步当前导入会话的历史气泡',
      'model.group.alias': 'Claude 别名',
      'model.group.mapped': '已映射 / 环境',
      'model.group.custom': '自定义',
      'model.item.default.label': 'Default（推荐）',
      'model.item.default.desc':
        '使用 Claude Code 当前默认模型（settings.model / 环境）',
      'model.item.opus.desc': '高能力别名 · 映射到 DEFAULT_OPUS 或官方 Opus',
      'model.item.sonnet.desc': '均衡别名 · 映射到 DEFAULT_SONNET 或官方 Sonnet',
      'model.item.haiku.desc': '更快更便宜 · 映射到 DEFAULT_HAIKU 或官方 Haiku',
      'model.item.fable.desc': 'Fable 别名 · 映射到 DEFAULT_FABLE',
      'model.item.custom.desc': '自定义模型',
      'model.item.mappedFromEnv': '{prefix}（来自 settings.env）',
      'model.item.settingsModel': '当前 settings.model',
      'msg.pleaseOpenChat': '请先打开一个对话',
      'msg.createFail': '无法创建对话',
      'msg.sendFail': '发送失败',
      'msg.stillGenerating': '还在生成中，请稍候或点停止',
      'msg.submittedBg': '已提交 · 后台运行中…',
      'msg.submittedWait': '已发送 · 等待 Claude…',
      'msg.bgSubmitted': '后台任务已提交 · 关掉网页也会继续跑',
      'msg.stopping': '正在停止…',
      'msg.stopFail': '停止失败',
      'msg.stopped': '已停止',
      'msg.error': '出错',
      'msg.rewound': '已回退',
      'msg.rewindConfirmLast': '回退最近一轮用户消息及其回复？',
      'msg.rewindConfirmTo': '回退到该条消息之前？（该条及之后都会删除）',
      'msg.rewindFail': '回退失败',
      'msg.rewindWhileRunning': '生成中，请结束后再回退',
      'msg.delChatConfirm': '删除这个对话？',
      'msg.newChatFail': '新建失败',
      'msg.openFail': '打开会话失败',
      'msg.loadFail': '加载失败: {m}',
      'msg.sseReconnect': '连接中断，重连中…',
      'msg.importSwitchFail': '切换导入会话失败',
      'msg.syncingCli': '正在从 CLI 同步历史…',
      'msg.syncedN': '已同步 {n} 条',
      'msg.syncedFromCli': '已从 CLI 同步 {n} 条新消息',
      'msg.onlyRecent': '（仅最近段）',
      'msg.syncBusy': '生成中，稍后再同步',
      'msg.syncFresh': '已是最新，无新消息',
      'msg.syncFail': '同步失败',
      'msg.bgStill': '后台任务仍在运行（已恢复进度）…',
      'msg.jobStill': '任务仍在运行…',
      'msg.bgRunningCanClose': '后台任务运行中（可关网页）…',
      'msg.bgStarted': '后台任务已启动 · 关掉网页也会继续',
      'msg.runningPerm': '运行中 · 权限 {m}',
      'msg.permEffective': '权限生效: {m}',
      'msg.permRequested': '（请求 {r}）',
      'msg.thinkingBg': '后台任务运行中 · 可关网页…',
      'msg.thinking': 'Claude 正在思考 / 操作…',
      'msg.tool': '工具: {n}',
      'tool.timeline': '工具',
      'tool.running': '运行中',
      'tool.done': '完成',
      'tool.error': '失败',
      'tool.interrupted': '已中断',
      'tool.emptyInput': '（无参数）',
      'tool.emptyResult': '（无输出）',
      'tool.overflow': '另有 {n} 步已折叠',
      'tool.show': '展开',
      'tool.hide': '收起',
      'tool.count': '{n} 步',
      'msg.generating': '生成中…',
    },
    en: {
      'common.close': 'Close',
      'common.menu': 'Menu',
      'common.delete': 'Delete',
      'common.deleteAria': 'Delete chat',
      'common.you': 'You',
      'common.claude': 'Claude',
      'common.loading': 'Loading…',
      'common.justNow': 'just now',
      'common.secAgo': '{n}s ago',
      'common.minAgo': '{n}m ago',
      'common.hrAgo': '{n}h ago',
      'common.dayAgo': '{n}d ago',
      'common.reqTimeout': 'Request timed out',
      'sidebar.title': 'Chats',
      'sidebar.newChat': '+ New chat',
      'sidebar.import': '⬇ Import local session',
      'sidebar.foot':
        'Type <code>/help</code> for commands<br/><code>/resume</code> import local CLI session<br/><code>/rewind</code> undo last turn',
      'sidebar.empty': 'No chats yet',
      'status.ready': 'Ready',
      'status.running': 'Generating…',
      'status.runningBg': 'Background job running…',
      'status.opening': 'Opening…',
      'status.openFailed': 'Failed to open',
      'status.loadingChat': 'Loading…',
      'chat.defaultTitle': 'Chat',
      'chat.emptyTitle': 'Claude Phone',
      'chat.emptyBody':
        'Mobile chat UI for local Claude Code<br/>Scrollable history · relay API · Markdown',
      'chat.emptyHints':
        'Top-right <b>/</b> commands · <b>⚙</b> API · model chip<br/><code>/rewind</code> undo · mode chip ≈ Shift+Tab<br/><b>Background</b>: on = keep running when tab closes; off = stop ~4s after disconnect',
      'model.pickTitle': 'Choose model',
      'model.sheetTitle': 'Choose model',
      'model.sheetSub': 'Session override vs global default',
      'model.searchPh': 'Search models / aliases…',
      'model.scopeAria': 'Scope',
      'model.scopeSession': 'This chat',
      'model.scopeDefault': 'Set default',
      'model.listAria': 'Model list',
      'model.addCustom': 'Add custom model',
      'model.customIdPh': 'Model ID (relay name)',
      'model.customLabelPh': 'Display name (optional)',
      'model.addBtn': 'Add',
      'model.sessionOverride': 'Session override',
      'model.globalDefault': 'Global default',
      'model.subSession': 'Session: {s} · Default: {d}',
      'model.subDefault': 'Global default: {d}',
      'model.loadFail': 'Failed to load models',
      'model.groupAlias': 'Claude aliases',
      'model.groupMapped': 'Mapped / env',
      'model.groupCustom': 'Custom',
      'model.empty': 'No matching models<br/>Add a custom ID below',
      'model.delCustom': 'Remove this custom model',
      'model.selectedMark': 'Selected',
      'model.busySwitch': 'Generating — switch model after it finishes',
      'model.switching': 'Switching…',
      'model.switched': 'Model set to {m} ({scope}) · applies next message',
      'model.scopeSessionLabel': 'this chat',
      'model.scopeDefaultLabel': 'global default',
      'model.savedDefault': 'Saved to settings.model for new chats',
      'model.savedSession': 'This chat only — global default unchanged',
      'model.busyRetry': 'Busy — try again later',
      'model.switchFail': 'Switch failed',
      'model.needId': 'Enter a model ID',
      'model.idTooLong': 'Model ID too long (max 200)',
      'model.added': 'Added — tap to use',
      'model.addFail': 'Add failed',
      'model.delConfirm': 'Remove custom model {id}?',
      'model.delFail': 'Delete failed',
      'resume.sheetTitle': 'Import local session',
      'resume.sheetSub':
        'Scans ~/.claude/projects · auto-sync on open · tap Sync to force refresh',
      'resume.searchPh': 'Search title / path / preview…',
      'resume.listAria': 'Local sessions',
      'resume.scanning': 'Scanning local sessions…',
      'resume.count': '{n} local CLI sessions · tap to --resume',
      'resume.hintOk': 'Tap to import; already-imported ones open directly',
      'resume.hintEmpty': 'No importable CLI sessions found',
      'resume.scanFail': 'Scan failed',
      'resume.noMatch': 'No matching sessions',
      'resume.badgeInWeb': 'In web',
      'resume.badgeHistory': 'History only',
      'resume.badgeCli': 'Local CLI',
      'resume.unknownDir': '(unknown path)',
      'resume.sync': 'Sync',
      'resume.syncTitle': 'Re-sync history from CLI',
      'resume.markOpen': 'Open',
      'resume.markHistory': 'Hist',
      'resume.markImport': 'Add',
      'resume.hintInteractive':
        'Interactive session: import bubbles; web continues via history inject (no --resume)',
      'resume.hintOpen': 'Already in web · tap to open',
      'resume.hintResume': 'Can --resume',
      'resume.historyOnly': ' · history only',
      'resume.opening': 'Opening chat…',
      'resume.importing': 'Importing…',
      'resume.switched': 'Switched to the web chat bound to that CLI session',
      'resume.syncedN': 'Synced {n} new messages',
      'resume.truncated': ' (truncated)',
      'resume.nextResume': ' · next message uses --resume',
      'resume.importedN': 'Imported {n} history messages',
      'resume.openedFresh': 'Opened ({n} history msgs, already up to date)',
      'resume.alreadyOpen': 'Session already exists — opened',
      'resume.noText': 'Imported (no displayable text) · next uses --resume',
      'resume.imported': 'Imported · next message will --resume',
      'resume.noFile': ' (jsonl not found on host; resume may fail)',
      'resume.badResp': 'Unexpected import response',
      'resume.importingWait': 'Import in progress — wait a moment',
      'resume.importFail': 'Import failed',
      'resume.syncing': 'Syncing…',
      'resume.syncFail': 'Sync failed',
      'cmd.title': 'Commands',
      'cmd.aria': 'Commands',
      'cmd.panelTitle': 'Commands',
      'cmd.panelHint': 'Tap or type /help',
      'cmd.empty': 'Type /help',
      'cmd.noMatch': 'No match · Enter still sends',
      'mode.chipTitle': 'Permission mode (like Shift+Tab)',
      'mode.panelTitle': 'Permission mode',
      'mode.panelHint': 'Like desktop Shift+Tab',
      'mode.set': 'Mode set to {m} · applies next message',
      'mode.switchFail': 'Switch failed',
      'settings.title': 'API / relay settings',
      'settings.aria': 'Settings',
      'settings.panelTitle': 'API / relay settings',
      'settings.rawSummary': 'Advanced: full settings.json',
      'settings.reload': 'Reload',
      'settings.save': 'Save',
      'settings.loading': 'Loading…',
      'settings.loadFail': 'Load failed',
      'settings.readFail': 'Cannot read settings',
      'settings.setHint': 'Set (leave blank to keep; __CLEAR__ to remove)',
      'settings.unset': 'Not set',
      'settings.rawNote':
        '(If you paste full JSON below, it replaces settings.json. Use fields above for secrets.)',
      'settings.saving': 'Saving…',
      'settings.rawInvalid': 'Invalid raw JSON:',
      'settings.saved':
        'Saved. New turns pick up config (in-flight jobs keep old env).',
      'settings.saveFail': 'Save failed',
      'hud.aria': 'Session status',
      'hud.model': 'Current model',
      'hud.mode': 'Permission mode',
      'hud.duration': 'Session duration',
      'hud.context': 'Context usage (last turn estimate)',
      'hud.modelPrefix': 'Model: ',
      'hud.modePrefix': 'Mode: ',
      'hud.durationPrefix': 'Session running ',
      'hud.contextEmpty': 'Context: shows after a turn (from CLI usage)',
      'composer.bgTitle':
        'On: keep running if you close the tab. Off: stop ~4s after disconnect',
      'composer.bgLabel': 'Background',
      'composer.jobPill': 'Running in background',
      'composer.jobPillLong': 'Background · tab can close',
      'composer.placeholder': 'Message Claude… type / for commands',
      'composer.send': 'Send',
      'composer.stop': 'Stop',
      'action.rewindTo': 'Rewind before this',
      'action.rewindLast': 'Rewind turn /rewind',
      'md.copy': 'Copy',
      'md.copied': 'Copied',
      'md.copyFail': 'Failed',
      'theme.system': 'System',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'theme.cycleTip': 'Theme: {m} (tap to cycle)',
      'lang.zh': '中文',
      'lang.en': 'EN',
      'lang.cycleTip': 'Language: {m} (tap to switch)',
      'mode.label.default': 'Default',
      'mode.label.acceptEdits': 'Accept edits',
      'mode.label.plan': 'Plan only',
      'mode.label.auto': 'Auto',
      'mode.label.bypassPermissions': 'Bypass permissions',
      'mode.label.dontAsk': 'Allowlist only',
      'mode.label.manual': 'Default',
      'mode.hint.default':
        'Non-interactive default: tools not on the allow list are denied or limited; no approval prompts on the web',
      'mode.hint.acceptEdits':
        'Auto-accept file edits and common filesystem commands in the workspace',
      'mode.hint.plan': 'Read-only exploration; avoid editing source',
      'mode.hint.auto': 'Auto mode (requires CLI support; may fail otherwise)',
      'mode.hint.bypassPermissions':
        'Skip permission prompts (dangerous — own server only)',
      'mode.hint.dontAsk': 'Deny any tool not listed in permissions.allow',
      'mode.hint.manual': 'Same as default (-p cannot show real manual prompts)',
      'cmd.summary.help': 'List available commands',
      'cmd.summary.rewind': 'Rewind: /rewind or /rewind 1 (N user turns)',
      'cmd.summary.clear': 'Clear this chat context (keep the session shell)',
      'cmd.summary.compact': 'Compact: drop early turns, keep recent ones',
      'cmd.summary.status': 'Show session status (mode / cwd / resume)',
      'cmd.summary.mode':
        'Set permission: /mode acceptEdits|plan|default|dontAsk|bypassPermissions',
      'cmd.summary.cwd': 'Show or set working directory: /cwd or /cwd /path',
      'cmd.summary.model': 'Open model picker (or /model <id>)',
      'cmd.summary.resume':
        'Import a local CLI session (~/.claude/projects, --resume)',
      'cmd.summary.sync':
        'Incrementally sync history bubbles from the CLI transcript',
      'model.group.alias': 'Claude aliases',
      'model.group.mapped': 'Mapped / env',
      'model.group.custom': 'Custom',
      'model.item.default.label': 'Default (recommended)',
      'model.item.default.desc':
        'Use Claude Code default model (settings.model / environment)',
      'model.item.opus.desc': 'Highest capability alias · maps to DEFAULT_OPUS or Opus',
      'model.item.sonnet.desc': 'Balanced alias · maps to DEFAULT_SONNET or Sonnet',
      'model.item.haiku.desc': 'Faster / cheaper · maps to DEFAULT_HAIKU or Haiku',
      'model.item.fable.desc': 'Fable alias · maps to DEFAULT_FABLE',
      'model.item.custom.desc': 'Custom model',
      'model.item.mappedFromEnv': '{prefix} (from settings.env)',
      'model.item.settingsModel': 'Current settings.model',
      'msg.pleaseOpenChat': 'Open a chat first',
      'msg.createFail': 'Could not create chat',
      'msg.sendFail': 'Send failed',
      'msg.stillGenerating': 'Still generating — wait or stop',
      'msg.submittedBg': 'Submitted · running in background…',
      'msg.submittedWait': 'Sent · waiting for Claude…',
      'msg.bgSubmitted': 'Background job submitted · keeps running if tab closes',
      'msg.stopping': 'Stopping…',
      'msg.stopFail': 'Stop failed',
      'msg.stopped': 'Stopped',
      'msg.error': 'Error',
      'msg.rewound': 'Rewound',
      'msg.rewindConfirmLast': 'Rewind the last user turn and its reply?',
      'msg.rewindConfirmTo':
        'Rewind before this message? (this and later messages will be deleted)',
      'msg.rewindFail': 'Rewind failed',
      'msg.rewindWhileRunning': 'Still generating — rewind after it finishes',
      'msg.delChatConfirm': 'Delete this chat?',
      'msg.newChatFail': 'Could not create chat',
      'msg.openFail': 'Failed to open chat',
      'msg.loadFail': 'Load failed: {m}',
      'msg.sseReconnect': 'Connection lost, reconnecting…',
      'msg.importSwitchFail': 'Failed to switch imported chat',
      'msg.syncingCli': 'Syncing history from CLI…',
      'msg.syncedN': 'Synced {n}',
      'msg.syncedFromCli': 'Synced {n} new messages from CLI',
      'msg.onlyRecent': ' (recent segment only)',
      'msg.syncBusy': 'Generating — sync later',
      'msg.syncFresh': 'Already up to date',
      'msg.syncFail': 'Sync failed',
      'msg.bgStill': 'Background job still running (restored)…',
      'msg.jobStill': 'Job still running…',
      'msg.bgRunningCanClose': 'Background job running (tab can close)…',
      'msg.bgStarted': 'Background job started · keeps running if tab closes',
      'msg.runningPerm': 'Running · mode {m}',
      'msg.permEffective': 'Mode: {m}',
      'msg.permRequested': ' (requested {r})',
      'msg.thinkingBg': 'Background job · tab can close…',
      'msg.thinking': 'Claude is thinking / working…',
      'msg.tool': 'Tool: {n}',
      'tool.timeline': 'Tools',
      'tool.running': 'Running',
      'tool.done': 'Done',
      'tool.error': 'Failed',
      'tool.interrupted': 'Interrupted',
      'tool.emptyInput': '(no input)',
      'tool.emptyResult': '(no output)',
      'tool.overflow': '+{n} more steps truncated',
      'tool.show': 'Expand',
      'tool.hide': 'Collapse',
      'tool.count': '{n} steps',
      'msg.generating': 'Generating…',
    },
  };

  const THEME_KEY = 'cp_theme';
  const LANG_KEY = 'cp_lang';
  const THEME_ORDER = ['system', 'light', 'dark'];

  function detectLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch {
      /* ignore */
    }
    const nav = (navigator.language || navigator.userLanguage || 'zh').toLowerCase();
    return nav.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  function detectThemePref() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* ignore */
    }
    return 'system';
  }

  function systemIsDark() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch {
      return false;
    }
  }

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return systemIsDark() ? 'dark' : 'light';
  }

  let lang = detectLang();
  let themePref = detectThemePref();

  function t(key, vars) {
    const pack = I18N[lang] || I18N.zh;
    let s = pack[key];
    if (s == null) s = (I18N.zh && I18N.zh[key]) || key;
    if (vars && typeof vars === 'object') {
      s = String(s).replace(/\{(\w+)\}/g, (_, k) =>
        vars[k] != null ? String(vars[k]) : ''
      );
    }
    return s;
  }

  function applyThemeColorMeta(resolved) {
    const meta = document.getElementById('meta-theme-color') ||
      document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#141413' : '#f5f4ed');
    // iOS status bar style
    let sb = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (sb) sb.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');
  }

  function applyTheme(pref) {
    themePref = pref === 'light' || pref === 'dark' || pref === 'system' ? pref : 'system';
    const resolved = resolveTheme(themePref);
    const root = document.documentElement;
    root.setAttribute('data-theme-pref', themePref);
    root.setAttribute('data-theme', resolved);
    try {
      localStorage.setItem(THEME_KEY, themePref);
    } catch {
      /* ignore */
    }
    applyThemeColorMeta(resolved);
    updateThemeChrome();
  }

  function updateThemeChrome() {
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    const btn = document.getElementById('btn-theme');
    const icons = { system: '◐', light: '☀', dark: '☾' };
    if (icon) icon.textContent = icons[themePref] || '◐';
    if (label) label.textContent = t('theme.' + themePref);
    if (btn) {
      btn.title = t('theme.cycleTip', { m: t('theme.' + themePref) });
      btn.setAttribute('aria-label', btn.title);
    }
  }

  function cycleTheme() {
    const i = THEME_ORDER.indexOf(themePref);
    const next = THEME_ORDER[(i + 1) % THEME_ORDER.length];
    applyTheme(next);
  }

  function applyLang(next) {
    lang = next === 'en' ? 'en' : 'zh';
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    document.documentElement.setAttribute('data-lang', lang);
    applyStaticI18n();
    updateThemeChrome();
    updateLangChrome();
    // re-render dynamic UI bits (client i18n by id — no wait for network)
    try {
      renderSessions();
      renderModes();
      renderCommands(
        (inputEl.value || '').trim().startsWith('/')
          ? (inputEl.value || '').trim().split(/\s/)[0]
          : ''
      );
      updateModelChip();
      if (modelCatalog) renderModelList();
      if (resumeCatalog) renderResumeList();
      if (messages.length || streamingId) renderMessages();
      else if (!currentId) renderEmpty();
      // status line ready text if idle
      if (!running && chatSub && (!chatSub.textContent || /准备|Ready|打开|Open|失败|fail/i.test(chatSub.textContent))) {
        chatSub.textContent = t('status.ready');
      }
      if (jobPill && !jobPill.classList.contains('hidden')) {
        jobPill.textContent = t('composer.jobPillLong');
      }
      // Refresh server-localized meta/catalog in background (Accept-Language)
      loadMeta().catch(() => {});
      loadModels().catch(() => {});
    } catch {
      /* early boot: functions not ready yet */
    }
  }

  function updateLangChrome() {
    const label = document.getElementById('lang-label');
    const btn = document.getElementById('btn-lang');
    if (label) label.textContent = lang === 'en' ? t('lang.en') : t('lang.zh');
    if (btn) {
      btn.title = t('lang.cycleTip', { m: lang === 'en' ? 'English' : '中文' });
      btn.setAttribute('aria-label', btn.title);
    }
  }

  function cycleLang() {
    applyLang(lang === 'zh' ? 'en' : 'zh');
  }

  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
  }

  // Apply immediately (before DOM wiring) for correct first paint
  applyTheme(themePref);
  // lang attributes already set by head script; still sync chrome later
  try {
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
  } catch {
    /* ignore */
  }

  // Follow OS theme when pref is system
  try {
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (themePref === 'system') applyTheme('system');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  } catch {
    /* ignore */
  }
  const messagesEl = $('messages');
  const inputEl = $('input');
  const btnSend = $('btn-send');
  const btnStop = $('btn-stop');
  const btnMenu = $('btn-menu');
  const btnCloseSidebar = $('btn-close-sidebar');
  const btnNewChat = $('btn-new-chat');
  const btnImportSession = $('btn-import-session');
  const btnMode = $('btn-mode');
  const btnCmd = $('btn-cmd');
  const btnSettings = $('btn-settings');
  const btnModel = $('btn-model');
  const modelChipLabel = $('model-chip-label');
  const modelSheet = $('model-sheet');
  const modelSheetMask = $('model-sheet-mask');
  const modelList = $('model-list');
  const modelSearch = $('model-search');
  const modelSheetMsg = $('model-sheet-msg');
  const modelSheetSub = $('model-sheet-sub');
  const btnModelClose = $('btn-model-close');
  const btnModelAdd = $('btn-model-add');
  const modelCustomId = $('model-custom-id');
  const modelCustomLabel = $('model-custom-label');
  const resumeSheet = $('resume-sheet');
  const resumeSheetMask = $('resume-sheet-mask');
  const resumeList = $('resume-list');
  const resumeSearch = $('resume-search');
  const resumeSheetMsg = $('resume-sheet-msg');
  const resumeSheetSub = $('resume-sheet-sub');
  const btnResumeClose = $('btn-resume-close');
  const sidebar = $('sidebar');
  const sidebarMask = $('sidebar-mask');
  const sessionList = $('session-list');
  const chatTitle = $('chat-title');
  const chatSub = $('chat-sub');
  const statusLine = $('status-line');
  const hudModel = $('hud-model');
  const hudMode = $('hud-mode');
  const hudDuration = $('hud-duration');
  const hudCtxFill = $('hud-ctx-fill');
  const hudCtxPct = $('hud-ctx-pct');
  const hudContext = $('hud-context');
  const modePanel = $('mode-panel');
  const modeOptions = $('mode-options');
  const cmdPanel = $('cmd-panel');
  const cmdOptions = $('cmd-options');
  const settingsPanel = $('settings-panel');
  const settingsEnvFields = $('settings-env-fields');
  const settingsModel = $('settings-model');
  const settingsRaw = $('settings-raw');
  const settingsPathEl = $('settings-path');
  const settingsRuntime = $('settings-runtime');
  const settingsMsg = $('settings-msg');
  const btnSettingsSave = $('btn-settings-save');
  const btnSettingsReload = $('btn-settings-reload');
  const chkBackground = $('chk-background');
  const jobPill = $('job-pill');

  let meta = {
    permissionModes: [],
    defaultPermissionMode: 'acceptEdits',
    defaultBackground: true,
    workDir: '',
    commands: [],
  };
  let sessions = [];
  let currentId = null;
  let messages = [];
  let running = false;
  let es = null;
  let streamingId = null;
  let streamingText = '';
  /** @type {Array<{id:string|null,name:string,phase:string,input?:any,result?:any,isError?:boolean,ts?:number,endedAt?:number|null}>} */
  let streamingTools = [];
  let streamingToolOverflow = 0;
  let toolRenderTimer = null;
  let optimisticId = null;
  let activeJobId = null;

  /** @type {{ models: any[], settingsModel: string|null, groups: any[] }|null} */
  let modelCatalog = null;
  let modelScope = 'session'; // session | default
  let modelFilter = '';
  let selectingModel = false;

  /** @type {any[]|null} */
  let resumeCatalog = null;
  let resumeFilter = '';
  let importingResume = false;

  /** 轻量 HUD（仿 claude-hud：模型 / 模式 / 时长 / 上下文） */
  let hudState = {
    model: null,
    mode: null,
    sessionStartedAt: null,
    usage: null,
    lastTurnDurationMs: null,
  };
  let hudTimer = null;

  const BG_KEY = 'cp_background';
  try {
    const saved = localStorage.getItem(BG_KEY);
    if (saved != null) chkBackground.checked = saved === '1';
  } catch {
    /* ignore */
  }
  chkBackground.addEventListener('change', () => {
    try {
      localStorage.setItem(BG_KEY, chkBackground.checked ? '1' : '0');
    } catch {
      /* ignore */
    }
  });

  /** Normalize mode id (aliases like manual → default) for i18n lookup */
  function normalizeModeId(id) {
    const raw = String(id || '').trim();
    if (!raw) return meta.defaultPermissionMode || 'acceptEdits';
    if (raw === 'manual') return 'default';
    const known = (meta.permissionModes || []).map((x) => x.id);
    if (known.length && known.indexOf(raw) < 0) {
      // still try label/hint keys; unknown ids fall back to raw
    }
    return raw;
  }

  /**
   * Permission mode display label — always from client i18n by id.
   * Server meta.label is Chinese-only legacy; do not use it for chrome.
   */
  function modeLabel(id) {
    const mid = normalizeModeId(id);
    const key = 'mode.label.' + mid;
    const translated = t(key);
    if (translated && translated !== key) return translated;
    const m = (meta.permissionModes || []).find((x) => x.id === mid || x.id === id);
    return (m && m.label) || mid || id || '—';
  }

  function modeHintText(id) {
    const mid = normalizeModeId(id);
    const key = 'mode.hint.' + mid;
    const translated = t(key);
    if (translated && translated !== key) return translated;
    const m = (meta.permissionModes || []).find((x) => x.id === mid || x.id === id);
    return (m && m.hint) || '';
  }

  function commandSummary(c) {
    if (!c) return '';
    const id = c.id || '';
    const key = 'cmd.summary.' + id;
    const translated = t(key);
    if (translated && translated !== key) return translated;
    return c.summary || '';
  }

  function modelGroupLabel(groupId, fallback) {
    const key = 'model.group.' + groupId;
    const translated = t(key);
    if (translated && translated !== key) return translated;
    // legacy dictionary keys used as fallbacks in renderModelList
    if (groupId === 'alias') return t('model.groupAlias');
    if (groupId === 'mapped') return t('model.groupMapped');
    if (groupId === 'custom') return t('model.groupCustom');
    return fallback || groupId;
  }

  async function api(path, opts = {}) {
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 60000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const { timeoutMs: _t, headers: extraHeaders, ...rest } = opts;
      const res = await fetch(path, {
        headers: {
          'Content-Type': 'application/json',
          // Drive /api/meta (and friends) language negotiation
          'Accept-Language': lang === 'en' ? 'en' : 'zh-CN',
          ...(extraHeaders || {}),
        },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
        ...rest,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || data.message || res.statusText);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error(t('common.reqTimeout'));
        err.status = 408;
        throw err;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function isMobileLayout() {
    return !window.matchMedia || !window.matchMedia('(min-width: 900px)').matches;
  }

  function isSheetOpen(el) {
    return !!(el && !el.hidden && !el.classList.contains('hidden'));
  }

  function openSidebar(open) {
    sidebar.classList.toggle('hidden', !open);
    sidebarMask.classList.toggle('hidden', !open);
    if (btnMenu) btnMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
    // 侧栏打开时收起底部面板，避免叠层混乱
    if (open) {
      modePanel.classList.add('hidden');
      cmdPanel.classList.add('hidden');
      if (settingsPanel) settingsPanel.classList.add('hidden');
    }
  }

  /** 只关 mode/cmd/settings，不动 sheet */
  function hideBottomPanels() {
    modePanel.classList.add('hidden');
    cmdPanel.classList.add('hidden');
    if (settingsPanel) settingsPanel.classList.add('hidden');
  }

  function hidePanels() {
    hideBottomPanels();
    closeModelSheet({ restoreFocus: false });
    closeResumeSheet({ restoreFocus: false });
  }

  /** 按层级关掉最上层 UI：sheet → 面板 → 侧栏。返回是否关掉了什么 */
  function dismissTopLayer() {
    if (isSheetOpen(modelSheet)) {
      closeModelSheet({ restoreFocus: true });
      return true;
    }
    if (isSheetOpen(resumeSheet)) {
      closeResumeSheet({ restoreFocus: true });
      return true;
    }
    if (
      !modePanel.classList.contains('hidden') ||
      !cmdPanel.classList.contains('hidden') ||
      (settingsPanel && !settingsPanel.classList.contains('hidden'))
    ) {
      hideBottomPanels();
      return true;
    }
    if (isMobileLayout() && sidebar && !sidebar.classList.contains('hidden')) {
      openSidebar(false);
      return true;
    }
    return false;
  }

  function focusComposer() {
    try {
      if (inputEl && !running) inputEl.focus({ preventScroll: true });
    } catch {
      try {
        if (inputEl && !running) inputEl.focus();
      } catch {
        /* ignore */
      }
    }
  }

  function formatRelativeTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - Number(ms);
    if (diff < 0) return t('common.justNow');
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('common.secAgo', { n: sec });
    const min = Math.floor(sec / 60);
    if (min < 60) return t('common.minAgo', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 48) return t('common.hrAgo', { n: hr });
    const day = Math.floor(hr / 24);
    if (day < 30) return t('common.dayAgo', { n: day });
    try {
      return new Date(ms).toLocaleDateString();
    } catch {
      return '';
    }
  }

  function currentSessionModel() {
    const s = currentSession();
    if (s && s.sessionModel) return s.sessionModel;
    return null;
  }

  function effectiveModelId() {
    return currentSessionModel() || (modelCatalog && modelCatalog.settingsModel) || 'default';
  }

  /**
   * Localize built-in / stock model catalog fields by id/group.
   * API may already be localized via Accept-Language; this is defense-in-depth
   * for cached catalog or stale Chinese placeholders.
   */
  function localizeModelEntry(m) {
    if (!m || typeof m !== 'object') return m;
    const id = String(m.id || '');
    const group = m.group || '';
    let label = m.label;
    let description = m.description || '';

    if (id === 'default') {
      label = t('model.item.default.label');
      description = t('model.item.default.desc');
    } else if (id === 'opus' || m.alias === 'opus') {
      if (group === 'alias') description = t('model.item.opus.desc');
    } else if (id === 'sonnet' || m.alias === 'sonnet') {
      if (group === 'alias') description = t('model.item.sonnet.desc');
    } else if (id === 'haiku' || m.alias === 'haiku') {
      if (group === 'alias') description = t('model.item.haiku.desc');
    } else if (id === 'fable' || m.alias === 'fable') {
      if (group === 'alias') description = t('model.item.fable.desc');
    }

    if (group === 'custom') {
      if (!description || description === '自定义模型' || description === 'Custom model') {
        description = t('model.item.custom.desc');
      }
    }
    if (group === 'mapped') {
      // Stock patterns from older servers
      const fromEnvZh = /（来自 settings\.env）$/;
      const fromEnvEn = / \(from settings\.env\)$/;
      if (fromEnvZh.test(description) || fromEnvEn.test(description)) {
        const prefix = String(description)
          .replace(fromEnvZh, '')
          .replace(fromEnvEn, '');
        description = t('model.item.mappedFromEnv', { prefix });
      } else if (
        description === '当前 settings.model' ||
        description === 'Current settings.model'
      ) {
        description = t('model.item.settingsModel');
      }
    }

    return { ...m, label: label || m.label || id, description };
  }

  function modelLabelForId(id) {
    if (!id || id === 'default') return t('model.item.default.label');
    const m = (modelCatalog && modelCatalog.models) || [];
    const hit = m.find((x) => x.id === id || x.resolved === id);
    if (hit) {
      const loc = localizeModelEntry(hit);
      return loc.label || hit.id || id;
    }
    return id;
  }

  function updateModelChip() {
    if (!modelChipLabel) return;
    const sessionM = currentSessionModel();
    const id = sessionM || (modelCatalog && modelCatalog.settingsModel) || 'default';
    modelChipLabel.textContent = modelLabelForId(id === 'default' ? 'default' : id);
    const dot = btnModel && btnModel.querySelector('.model-chip-dot');
    if (dot) {
      dot.classList.toggle('session', !!sessionM);
      dot.title = sessionM ? t('model.sessionOverride') : t('model.globalDefault');
    }
    if (modelSheetSub) {
      const def = modelCatalog && modelCatalog.settingsModel;
      modelSheetSub.textContent = sessionM
        ? t('model.subSession', { s: modelLabelForId(sessionM), d: modelLabelForId(def || 'default') })
        : t('model.subDefault', { d: modelLabelForId(def || 'default') });
    }
    // 无 CLI 实测 model 时，HUD 跟随 chip；有实测则只刷新展示
    renderHud();
  }

  async function loadModels() {
    try {
      modelCatalog = await api('/api/models', { timeoutMs: 15000 });
      updateModelChip();
      renderModelList();
    } catch (e) {
      if (modelSheetMsg) modelSheetMsg.textContent = e.message || t('model.loadFail');
    }
  }

  function openModelSheet() {
    // 互斥：关其它层再开模型 sheet
    hideBottomPanels();
    closeResumeSheet({ restoreFocus: false });
    openSidebar(false);
    if (modelSheet) {
      modelSheet.hidden = false;
      modelSheet.classList.remove('hidden');
    }
    if (modelSheetMask) {
      modelSheetMask.hidden = false;
      modelSheetMask.classList.remove('hidden');
    }
    if (btnModel) btnModel.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sheet-open');
    loadModels();
    setTimeout(() => {
      if (modelSearch) {
        modelSearch.focus();
        modelSearch.select && modelSearch.select();
      }
    }, 50);
  }

  function closeModelSheet(opts) {
    const restoreFocus = !opts || opts.restoreFocus !== false;
    const wasOpen = isSheetOpen(modelSheet);
    if (modelSheet) {
      modelSheet.classList.add('hidden');
      modelSheet.hidden = true;
    }
    if (modelSheetMask) {
      modelSheetMask.classList.add('hidden');
      modelSheetMask.hidden = true;
    }
    if (btnModel) btnModel.setAttribute('aria-expanded', 'false');
    if (!isSheetOpen(resumeSheet)) document.body.classList.remove('sheet-open');
    if (restoreFocus && wasOpen) focusComposer();
  }

  let resumeLoadSeq = 0;

  function openResumeSheet() {
    // 不调用 hidePanels，避免 closeResumeSheet 自关；只关其它面板
    hideBottomPanels();
    closeModelSheet({ restoreFocus: false });
    openSidebar(false);
    if (resumeSheet) {
      resumeSheet.hidden = false;
      resumeSheet.classList.remove('hidden');
    }
    if (resumeSheetMask) {
      resumeSheetMask.hidden = false;
      resumeSheetMask.classList.remove('hidden');
    }
    document.body.classList.add('sheet-open');
    if (resumeSheetMsg) resumeSheetMsg.textContent = t('resume.scanning');
    if (resumeList) resumeList.innerHTML = `<div class="model-empty">${t('common.loading')}</div>`;
    loadResumeCatalog();
    setTimeout(() => {
      if (resumeSearch) {
        resumeSearch.focus();
        resumeSearch.select && resumeSearch.select();
      }
    }, 50);
  }

  function closeResumeSheet(opts) {
    const restoreFocus = !opts || opts.restoreFocus !== false;
    const wasOpen = isSheetOpen(resumeSheet);
    if (resumeSheet) {
      resumeSheet.classList.add('hidden');
      resumeSheet.hidden = true;
    }
    if (resumeSheetMask) {
      resumeSheetMask.classList.add('hidden');
      resumeSheetMask.hidden = true;
    }
    if (!isSheetOpen(modelSheet)) document.body.classList.remove('sheet-open');
    if (restoreFocus && wasOpen) focusComposer();
  }

  async function loadResumeCatalog() {
    const seq = ++resumeLoadSeq;
    try {
      const data = await api('/api/sessions/import?limit=100', { timeoutMs: 30000 });
      // 丢弃过期响应（快速连点打开/关闭/再开）
      if (seq !== resumeLoadSeq) return;
      resumeCatalog = Array.isArray(data.sessions) ? data.sessions : [];
      if (resumeSheetSub) {
        const n = data.count != null ? data.count : resumeCatalog.length;
        // 不把完整 home 路径铺到副标题（隐私 + 过长）；只显示条数
        resumeSheetSub.textContent = t('resume.count', { n });
      }
      if (resumeSheetMsg) {
        resumeSheetMsg.textContent = resumeCatalog.length
          ? t('resume.hintOk')
          : t('resume.hintEmpty');
      }
      renderResumeList();
    } catch (e) {
      if (seq !== resumeLoadSeq) return;
      if (resumeSheetMsg) resumeSheetMsg.textContent = e.message || t('resume.scanFail');
      resumeCatalog = [];
      renderResumeList();
    }
  }

  function renderResumeList() {
    if (!resumeList) return;
    if (!resumeCatalog) {
      resumeList.innerHTML = `<div class="model-empty">${t('common.loading')}</div>`;
      return;
    }
    const q = (resumeFilter || '').trim().toLowerCase();
    const items = resumeCatalog.filter((s) => {
      if (!s || !s.claudeSessionId) return false;
      if (!q) return true;
      const blob = `${s.title || ''} ${s.preview || ''} ${s.workDir || ''} ${s.claudeSessionId || ''}`.toLowerCase();
      return blob.includes(q);
    });
    if (!items.length) {
      resumeList.innerHTML = `<div class="model-empty">${
        resumeCatalog.length ? t('resume.noMatch') : t('resume.hintEmpty')
      }</div>`;
      return;
    }
    resumeList.innerHTML = items
      .map((s) => {
        const noResume = s.resumeSupported === false;
        const badge = s.imported
          ? `<span class="badge in-web">${t('resume.badgeInWeb')}</span>`
          : noResume
            ? `<span class="badge">${t('resume.badgeHistory')}</span>`
            : `<span class="badge">${t('resume.badgeCli')}</span>`;
        const when = formatRelativeTime(s.updatedAt);
        const cwd = s.workDir || t('resume.unknownDir');
        const sid = String(s.claudeSessionId || '');
        const sidShort = sid.slice(0, 8);
        const disabled = importingResume ? ' disabled' : '';
        // 已导入：主按钮打开；旁路「同步」强制增量
        const syncBtn = s.imported && s.webSessionId
          ? `<span role="button" tabindex="0" class="pill-action resume-sync" data-sync-web="${escapeHtml(s.webSessionId)}" title="${escapeHtml(t('resume.syncTitle'))}">${escapeHtml(t('resume.sync'))}</span>`
          : '';
        const mark = s.imported
          ? t('resume.markOpen')
          : noResume
            ? t('resume.markHistory')
            : t('resume.markImport');
        const hint = noResume
          ? t('resume.hintInteractive')
          : s.imported
            ? t('resume.hintOpen')
            : t('resume.hintResume');
        return `<button type="button" class="model-item resume-item ${s.imported ? 'selected' : ''}" role="option" data-claude-session="${escapeHtml(sid)}" data-web-session="${escapeHtml(s.webSessionId || '')}" data-imported="${s.imported ? '1' : '0'}" title="${escapeHtml(hint)}"${disabled}>
          <div class="ml">${escapeHtml(s.title || sidShort)}${badge}</div>
          ${syncBtn || `<div class="mk mark-text">${escapeHtml(mark)}</div>`}
          <div class="md">${escapeHtml(s.preview || '')}${noResume ? t('resume.historyOnly') : ''}</div>
          <div class="meta-line"><span>${escapeHtml(when)}</span><code title="${escapeHtml(cwd)}">${escapeHtml(cwd)}</code><span>${escapeHtml(sidShort)}</span></div>
        </button>`;
      })
      .join('');
  }

  async function importOrOpenResume(claudeSessionId, webSessionId, already) {
    const sid = String(claudeSessionId || '').trim();
    if (!sid || importingResume) return;
    importingResume = true;
    renderResumeList(); // 禁用列表项，防连点
    if (resumeSheetMsg) resumeSheetMsg.textContent = already ? t('resume.opening') : t('resume.importing');
    try {
      if (already && webSessionId) {
        closeResumeSheet();
        await selectSession(webSessionId);
        setStatus(t('resume.switched'), false);
        return;
      }
      const data = await api('/api/sessions/import', {
        method: 'POST',
        body: JSON.stringify({ claudeSessionId: sid }),
        timeoutMs: 20000,
      });
      await loadSessions();
      closeResumeSheet();
      if (data.session && data.session.id) {
        await selectSession(data.session.id);
        let tip;
        const appended = data.appended || 0;
        if (data.already && appended > 0) {
          tip =
            t('resume.syncedN', { n: appended }) +
            (data.historyTruncated ? t('resume.truncated') : '') +
            t('resume.nextResume');
        } else if (data.backfilled && data.historyCount > 0 && !data.already) {
          tip =
            t('resume.importedN', { n: data.historyCount }) +
            (data.historyTruncated ? t('resume.truncated') : '') +
            t('resume.nextResume');
        } else if (data.already && data.historyCount > 0) {
          tip = t('resume.openedFresh', { n: data.historyCount });
        } else if (data.already) {
          tip = t('resume.alreadyOpen');
        } else if (data.historyCount > 0) {
          tip =
            t('resume.importedN', { n: data.historyCount }) +
            (data.historyTruncated ? t('resume.truncated') : '') +
            t('resume.nextResume');
        } else if (data.fileFound !== false) {
          tip = t('resume.noText');
        } else {
          tip = t('resume.imported');
        }
        if (data.fileFound === false) {
          tip += t('resume.noFile');
        }
        setStatus(tip, false);
      } else {
        setStatus(t('resume.badResp'), false);
      }
    } catch (e) {
      if (resumeSheetMsg) {
        resumeSheetMsg.textContent =
          e.status === 409
            ? e.message || t('resume.importingWait')
            : e.message || t('resume.importFail');
      }
      setStatus(e.message || t('resume.importFail'), false);
    } finally {
      importingResume = false;
      // sheet 可能已关；若仍开着则恢复可点
      if (resumeSheet && !resumeSheet.hidden) renderResumeList();
    }
  }

  function renderModelList() {
    if (!modelList || !modelCatalog) return;
    const q = (modelFilter || '').trim().toLowerCase();
    const models = (modelCatalog.models || [])
      .map(localizeModelEntry)
      .filter((m) => {
        if (!q) return true;
        const blob = `${m.label || ''} ${m.id || ''} ${m.resolved || ''} ${m.description || ''}`.toLowerCase();
        return blob.includes(q);
      });

    const selected = effectiveModelId();
    const groups = modelCatalog.groups || [
      { id: 'alias', label: t('model.groupAlias') },
      { id: 'mapped', label: t('model.groupMapped') },
      { id: 'custom', label: t('model.groupCustom') },
    ];

    if (!models.length) {
      modelList.innerHTML = `<div class="model-empty">${t('model.empty')}</div>`;
      return;
    }

    let html = '';
    for (const g of groups) {
      const items = models.filter((m) => m.group === g.id);
      if (!items.length) continue;
      // Always prefer client i18n by group id
      const gLabel = modelGroupLabel(g.id, g.label);
      html += `<div class="model-group-label">${escapeHtml(gLabel)}</div>`;
      for (const m of items) {
        const isSel =
          selected === m.id ||
          selected === m.resolved ||
          (selected === 'default' && m.id === 'default') ||
          (!!m.isCurrentDefault && !currentSessionModel() && modelScope === 'default');
        const showDel = m.group === 'custom';
        html += `<button type="button" class="model-item ${isSel ? 'selected' : ''}" role="option" aria-selected="${isSel}" data-model-id="${escapeHtml(m.id)}">
          <div class="ml">${escapeHtml(m.label || m.id)}</div>
          ${isSel && !showDel ? `<div class="mk" title="${escapeHtml(t('model.selectedMark'))}">${ICON_CHECK}</div>` : ''}
          ${showDel ? `<span role="button" tabindex="0" class="icon-action mdel" data-del-model="${escapeHtml(m.id)}" title="${escapeHtml(t('model.delCustom'))}" aria-label="${escapeHtml(t('model.delCustom'))}">${ICON_TRASH}</span>` : ''}
          <div class="md">${escapeHtml(m.description || '')}</div>
          <div class="mr">${escapeHtml(m.displayResolved || m.resolved || m.id)}</div>
        </button>`;
      }
    }
    modelList.innerHTML = html;
  }

  async function selectModel(modelId) {
    if (selectingModel || !modelId) return;
    if (running && modelScope === 'session') {
      if (modelSheetMsg) {
        modelSheetMsg.textContent = t('model.busySwitch');
      }
      return;
    }
    selectingModel = true;
    if (btnModel) btnModel.disabled = true;
    if (modelSheetMsg) modelSheetMsg.textContent = t('model.switching');
    const prevSessions = sessions;
    try {
      const body = {
        model: modelId,
        scope: modelScope,
      };
      if (modelScope === 'session') {
        if (!currentId) await newChat();
        body.sessionId = currentId;
      }
      const res = await api('/api/models/select', {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 20000,
      });
      if (res.catalog) modelCatalog = res.catalog;
      else await loadModels();

      if (modelScope === 'session' && currentId) {
        sessions = sessions.map((s) =>
          s.id === currentId
            ? {
                ...s,
                sessionModel: modelId === 'default' ? null : modelId,
              }
            : s
        );
      }
      updateModelChip();
      renderModelList();
      const scopeText = modelScope === 'session' ? t('model.scopeSessionLabel') : t('model.scopeDefaultLabel');
      setStatus(
        t('model.switched', { m: modelLabelForId(modelId), scope: scopeText }),
        false
      );
      if (modelSheetMsg) {
        modelSheetMsg.textContent =
          modelScope === 'default'
            ? t('model.savedDefault')
            : t('model.savedSession');
      }
      setTimeout(() => closeModelSheet(), 280);
    } catch (e) {
      sessions = prevSessions;
      updateModelChip();
      if (modelSheetMsg) {
        modelSheetMsg.textContent =
          e.status === 409
            ? e.message || t('model.busyRetry')
            : e.message || t('model.switchFail');
      }
    } finally {
      selectingModel = false;
      if (btnModel) btnModel.disabled = false;
    }
  }

  async function addCustomModelUI() {
    if (selectingModel) return;
    const id = (modelCustomId && modelCustomId.value.trim()) || '';
    const label = (modelCustomLabel && modelCustomLabel.value.trim()) || '';
    if (!id) {
      if (modelSheetMsg) modelSheetMsg.textContent = t('model.needId');
      return;
    }
    if (id.length > 200) {
      if (modelSheetMsg) modelSheetMsg.textContent = t('model.idTooLong');
      return;
    }
    if (btnModelAdd) btnModelAdd.disabled = true;
    try {
      const res = await api('/api/models/custom', {
        method: 'POST',
        body: JSON.stringify({ id, model: id, label: label || id }),
        timeoutMs: 15000,
      });
      modelCatalog = res.catalog || modelCatalog;
      if (modelCustomId) modelCustomId.value = '';
      if (modelCustomLabel) modelCustomLabel.value = '';
      renderModelList();
      if (modelSheetMsg) modelSheetMsg.textContent = t('model.added');
    } catch (e) {
      if (modelSheetMsg) modelSheetMsg.textContent = e.message || t('model.addFail');
    } finally {
      if (btnModelAdd) btnModelAdd.disabled = false;
    }
  }

  async function deleteCustomModelUI(id) {
    if (!id || !confirm(t('model.delConfirm', { id }))) return;
    try {
      const res = await api(`/api/models/custom/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      modelCatalog = res.catalog || modelCatalog;
      renderModelList();
    } catch (e) {
      if (modelSheetMsg) modelSheetMsg.textContent = e.message || t('model.delFail');
    }
  }

  let settingsCache = null;

  async function loadSettings() {
    settingsMsg.textContent = t('settings.loading');
    try {
      settingsCache = await api('/api/settings');
      renderSettings(settingsCache);
      settingsMsg.textContent = '';
    } catch (e) {
      settingsMsg.textContent = e.message || t('settings.loadFail');
    }
  }

  function renderSettings(view) {
    if (!view || !view.ok) {
      settingsEnvFields.innerHTML = `<div class="muted">${t('settings.readFail')}</div>`;
      return;
    }
    settingsRuntime.textContent = `${view.user || 'claude'} · uid ${view.uid ?? '?'}`;
    settingsPathEl.textContent = view.path || '';
    settingsModel.value = view.model || '';

    const env = view.env || {};
    const keys = [];
    const seen = new Set();
    for (const k of view.preferredEnvKeys || []) {
      if (!seen.has(k)) {
        keys.push(k);
        seen.add(k);
      }
    }
    for (const k of Object.keys(env)) {
      if (!seen.has(k)) {
        keys.push(k);
        seen.add(k);
      }
    }
    // 保证常用键即使未设置也显示
    for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']) {
      if (!seen.has(k)) keys.unshift(k);
    }

    settingsEnvFields.innerHTML = keys
      .map((k) => {
        const meta = env[k] || { value: '', secret: /TOKEN|KEY|SECRET|PASS|AUTH/i.test(k), set: false };
        const ph = meta.secret
          ? meta.set
            ? t('settings.setHint')
            : t('settings.unset')
          : '';
        const val = meta.secret ? '' : meta.value || '';
        return `<label class="settings-label"><span class="k">${escapeHtml(k)}</span>
          <input type="${meta.secret ? 'password' : 'text'}" class="settings-input" data-env-key="${escapeHtml(k)}" data-secret="${meta.secret ? '1' : '0'}" value="${escapeHtml(val)}" placeholder="${escapeHtml(ph)}" autocomplete="off" spellcheck="false" />
        </label>`;
      })
      .join('');

    // raw：仅展示非 secret 的浅拷贝提示
    settingsRaw.value = t('settings.rawNote') + '\n';
  }

  async function saveSettings() {
    settingsMsg.textContent = t('settings.saving');
    const envUpdates = {};
    settingsEnvFields.querySelectorAll('[data-env-key]').forEach((input) => {
      const k = input.getAttribute('data-env-key');
      const secret = input.getAttribute('data-secret') === '1';
      const v = input.value;
      if (secret) {
        if (!v) return; // 留空不改
        if (v === '__CLEAR__') {
          envUpdates[k] = '__CLEAR__';
          return;
        }
        envUpdates[k] = v;
      } else {
        // 非 secret：允许清空为删除？这里空字符串写空
        envUpdates[k] = v;
      }
    });

    const body = {
      env: envUpdates,
      model: settingsModel.value.trim() || undefined,
    };

    // 若用户在 raw 里贴了完整 JSON 对象，优先用 raw
    const raw = settingsRaw.value.trim();
    if (raw.startsWith('{')) {
      try {
        body.rawJson = JSON.parse(raw);
        delete body.env;
        delete body.model;
      } catch (e) {
        settingsMsg.textContent = t('settings.rawInvalid') + ' ' + e.message;
        return;
      }
    }

    try {
      settingsCache = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      renderSettings(settingsCache);
      settingsMsg.textContent = t('settings.saved');
      // 清掉 input 里的 secret，避免残留
      settingsEnvFields.querySelectorAll('[data-secret="1"]').forEach((i) => {
        i.value = '';
      });
    } catch (e) {
      settingsMsg.textContent = e.message || t('settings.saveFail');
    }
  }

  function formatDuration(ms) {
    if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) < 0) return '—';
    let sec = Math.floor(Number(ms) / 1000);
    if (sec < 60) return sec + 's';
    const min = Math.floor(sec / 60);
    sec = sec % 60;
    if (min < 60) return min + 'm' + (sec ? sec + 's' : '');
    const hr = Math.floor(min / 60);
    const m2 = min % 60;
    if (hr < 48) return hr + 'h' + (m2 ? m2 + 'm' : '');
    const day = Math.floor(hr / 24);
    return day + 'd';
  }

  function formatTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(v);
  }

  function contextBarText(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const filled = Math.round(p / 10);
    let bar = '';
    for (let i = 0; i < 10; i++) bar += i < filled ? '█' : '░';
    return bar;
  }

  /**
   * @param {object} partial
   * @param {{ replace?: boolean }} [opts] replace=true 时整表替换（切会话），避免残留上一会话的 model/usage
   */
  function applyHud(partial, opts) {
    if (!partial && !(opts && opts.replace)) return;
    if (opts && opts.replace) {
      hudState = {
        model: partial && partial.model != null ? partial.model : null,
        mode:
          partial && (partial.mode != null || partial.permissionMode != null)
            ? partial.mode || partial.permissionMode
            : null,
        sessionStartedAt:
          partial && partial.sessionStartedAt != null
            ? Number(partial.sessionStartedAt) || null
            : null,
        usage: partial && partial.usage != null ? partial.usage : null,
        lastTurnDurationMs:
          partial && partial.durationMs != null
            ? Number(partial.durationMs)
            : null,
      };
      renderHud();
      return;
    }
    if (!partial) return;
    if (Object.prototype.hasOwnProperty.call(partial, 'model')) {
      hudState.model = partial.model || null;
    }
    if (
      Object.prototype.hasOwnProperty.call(partial, 'mode') ||
      Object.prototype.hasOwnProperty.call(partial, 'permissionMode')
    ) {
      hudState.mode = partial.mode || partial.permissionMode || null;
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'sessionStartedAt')) {
      const t = Number(partial.sessionStartedAt);
      hudState.sessionStartedAt = Number.isFinite(t) ? t : null;
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'usage')) {
      const u =
        partial.usage && typeof partial.usage === 'object'
          ? partial.usage
          : null;
      // 忽略 0/0 占位，避免把已有真实 Context 冲掉
      const meaningful =
        u &&
        ((Number(u.inputTokens) || 0) > 0 ||
          (Number(u.outputTokens) || 0) > 0 ||
          (Number(u.cacheReadInputTokens) || 0) > 0 ||
          (Number(u.cacheCreationInputTokens) || 0) > 0 ||
          (Number(u.contextUsed) || 0) > 0 ||
          (u.contextPct != null &&
            Number.isFinite(Number(u.contextPct)) &&
            Number(u.contextPct) > 0));
      if (meaningful) {
        hudState.usage = u;
      } else if (u == null) {
        // 显式 null 仅在 replace 路径使用；merge 路径不因空 usage 清空
      }
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'durationMs')) {
      const d = Number(partial.durationMs);
      hudState.lastTurnDurationMs = Number.isFinite(d) ? d : null;
    }
    renderHud();
  }

  function renderHud() {
    // model：优先 CLI 实际 model，否则 chip 有效模型
    if (hudModel) {
      let m = hudState.model || effectiveModelId() || '—';
      if (typeof m !== 'string') m = String(m || '—');
      // 过长模型 id 截断显示
      const label = modelLabelForId(m === 'default' ? 'default' : m);
      hudModel.textContent = label.length > 28 ? label.slice(0, 26) + '…' : label;
      hudModel.title = t('hud.modelPrefix') + m;
    }
    if (hudMode) {
      const mid =
        hudState.mode ||
        (currentSession() && currentSession().permissionMode) ||
        meta.defaultPermissionMode ||
        '—';
      hudMode.textContent = modeLabel(mid);
      hudMode.title = t('hud.modePrefix') + mid;
    }
    if (hudDuration) {
      const start = Number(hudState.sessionStartedAt);
      const elapsed =
        Number.isFinite(start) && start > 0 ? Date.now() - start : null;
      hudDuration.textContent = '⏱️ ' + formatDuration(elapsed);
      hudDuration.title =
        elapsed != null
          ? t('hud.durationPrefix') + formatDuration(elapsed)
          : t('hud.duration');
    }
    if (hudCtxFill && hudCtxPct) {
      const u = hudState.usage;
      const used = u ? Number(u.contextUsed) || 0 : 0;
      const hasTokens =
        u &&
        (used > 0 ||
          (Number(u.inputTokens) || 0) > 0 ||
          (Number(u.outputTokens) || 0) > 0 ||
          (Number(u.cacheReadInputTokens) || 0) > 0 ||
          (Number(u.cacheCreationInputTokens) || 0) > 0);
      let pct =
        u && u.contextPct != null && Number.isFinite(Number(u.contextPct))
          ? Number(u.contextPct)
          : null;
      // 历史脏数据：全 0 却写了 contextPct:0 → 当未知
      if (pct != null && !hasTokens) pct = null;
      if (pct == null) {
        hudCtxFill.style.width = '0%';
        hudCtxFill.classList.remove('warn', 'crit');
        hudCtxPct.textContent = '—';
        if (hudContext) {
          hudContext.title = t('hud.contextEmpty');
        }
      } else {
        const w = Math.max(0, Math.min(100, pct));
        hudCtxFill.style.width = w + '%';
        hudCtxFill.classList.toggle('warn', w >= 60 && w < 85);
        hudCtxFill.classList.toggle('crit', w >= 85);
        hudCtxPct.textContent = (Math.round(w * 10) / 10) + '%';
        if (hudContext) {
          const win = Number(u.contextWindow) || 0;
          hudContext.title =
            'Context ~' +
            formatTokens(used) +
            ' / ' +
            formatTokens(win) +
            '  ' +
            contextBarText(w) +
            '  in:' +
            formatTokens(u.inputTokens) +
            ' out:' +
            formatTokens(u.outputTokens);
        }
      }
    }
  }

  function ensureHudTimer() {
    if (hudTimer) return;
    hudTimer = setInterval(() => {
      if (hudState.sessionStartedAt) renderHud();
    }, 15000);
    // 页面隐藏时不必刷 DOM（省电）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (hudState.sessionStartedAt) renderHud();
    });
  }

  let statusClearTimer = null;
  function setStatus(text, runningFlag, opts) {
    if (statusClearTimer) {
      clearTimeout(statusClearTimer);
      statusClearTimer = null;
    }
    if (!text) {
      statusLine.classList.add('hidden');
      statusLine.textContent = '';
      statusLine.classList.remove('running');
      return;
    }
    statusLine.classList.remove('hidden');
    statusLine.classList.toggle('running', !!runningFlag);
    statusLine.textContent = text;
    // 非运行态提示自动淡出，避免状态行一直占着
    const autoMs =
      opts && opts.autoClearMs != null
        ? opts.autoClearMs
        : runningFlag
          ? 0
          : 4500;
    if (autoMs > 0) {
      statusClearTimer = setTimeout(() => {
        statusClearTimer = null;
        // 若期间又变成 running，不抢
        if (!running) {
          statusLine.classList.add('hidden');
          statusLine.textContent = '';
          statusLine.classList.remove('running');
        }
      }, autoMs);
    }
  }

  function setRunning(v, { background } = {}) {
    running = !!v;
    btnSend.classList.toggle('hidden', running);
    btnStop.classList.toggle('hidden', !running);
    btnSend.disabled = running || !inputEl.value.trim();
    inputEl.setAttribute('aria-busy', running ? 'true' : 'false');
    chatSub.textContent = running
      ? background || chkBackground.checked
        ? t('status.runningBg')
        : t('status.running')
      : t('status.ready');
    if (running && (background || chkBackground.checked)) {
      jobPill.classList.remove('hidden');
      jobPill.textContent = t('composer.jobPillLong');
    } else if (!running) {
      jobPill.classList.add('hidden');
      activeJobId = null;
    }
    // 生成中也刷新 HUD 时长
    renderHud();
  }

  /** 输入框以 / 开头时，按前缀过滤命令面板 */
  function updateCommandFilterFromInput() {
    const raw = (inputEl.value || '').trimStart();
    if (!raw.startsWith('/')) {
      if (!cmdPanel.classList.contains('hidden')) {
        // 已不在 slash 模式：若面板是因 / 打开的，可保留到用户主动关
      }
      renderCommands('');
      return false;
    }
    // 仅 slash 提示：整段是命令前缀（无空格后的正文）时过滤
    const space = raw.indexOf(' ');
    const prefix = space < 0 ? raw : raw.slice(0, space);
    // 已输入完整命令 + 空格：收起面板，留给参数
    if (space >= 0) {
      cmdPanel.classList.add('hidden');
      renderCommands('');
      return false;
    }
    renderCommands(prefix);
    return true;
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  }

  function scrollToBottom(force) {
    const near =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
    if (force || near) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Markdown → safe HTML (assistant). Falls back to escaped plain text. */
  let mdReady = false;
  function renderFence(code, infostring) {
    const lang = String(infostring || '').trim().split(/\s+/)[0] || '';
    const langClass = lang ? ` language-${escapeHtml(lang)}` : '';
    const label = lang || 'code';
    return (
      `<div class="md-code-wrap">` +
      `<div class="md-code-bar"><span class="md-code-lang">${escapeHtml(label)}</span>` +
      `<button type="button" class="md-copy" data-md-copy>${t('md.copy')}</button></div>` +
      `<pre class="md-pre"><code class="md-code${langClass}">${escapeHtml(code)}</code></pre>` +
      `</div>`
    );
  }

  function initMarkdown() {
    if (mdReady) return true;
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      return false;
    }
    try {
      marked.setOptions({
        gfm: true,
        breaks: true,
        pedantic: false,
        silent: true,
      });
      // marked v5–15: Renderer prototype hooks (most compatible across builds)
      if (marked.Renderer) {
        const renderer = new marked.Renderer();
        const origCode = renderer.code ? renderer.code.bind(renderer) : null;
        renderer.code = function (code, infostring, escaped) {
          // marked v11+ may pass token object as first arg
          if (code && typeof code === 'object') {
            const tok = code;
            return renderFence(tok.text || '', tok.lang || infostring || '');
          }
          return renderFence(code, infostring);
        };
        renderer.link = function (href, title, text) {
          if (href && typeof href === 'object') {
            // token form
            const tok = href;
            href = tok.href;
            title = tok.title;
            text = tok.text;
          }
          const h = String(href || '');
          if (/^\s*javascript:/i.test(h) || /^\s*vbscript:/i.test(h) || /^\s*data:text\/html/i.test(h)) {
            return escapeHtml(String(text || h));
          }
          const t = title ? ` title="${escapeHtml(title)}"` : '';
          // text may already be html from marked — purify later
          return `<a href="${escapeHtml(h)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
        };
        marked.setOptions({ renderer });
      }
      mdReady = true;
      return true;
    } catch (e) {
      console.warn('markdown init failed', e);
      return false;
    }
  }

  const PURIFY_OPTS = {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      'a',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'del',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'span',
      'div',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'img',
      'button',
    ],
    ALLOWED_ATTR: [
      'href',
      'title',
      'target',
      'rel',
      'class',
      'src',
      'alt',
      'type',
      'data-md-copy',
    ],
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
  };

  function formatMarkdown(src) {
    const text = src == null ? '' : String(src);
    if (!text) return '';
    if (!initMarkdown()) {
      return `<pre class="md-fallback">${escapeHtml(text)}</pre>`;
    }
    try {
      // marked v11+: marked.parse; older: marked()
      const parse = typeof marked.parse === 'function' ? marked.parse.bind(marked) : marked;
      let html = parse(text);
      // If custom renderer didn't run (CDN build quirks), enhance <pre><code>
      if (html && html.indexOf('md-code-wrap') === -1 && html.indexOf('<pre>') !== -1) {
        html = html.replace(
          /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
          (_, lang, code) => {
            const label = lang || 'code';
            return (
              `<div class="md-code-wrap"><div class="md-code-bar">` +
              `<span class="md-code-lang">${escapeHtml(label)}</span>` +
              `<button type="button" class="md-copy" data-md-copy>${t('md.copy')}</button></div>` +
              `<pre class="md-pre"><code class="md-code${lang ? ` language-${escapeHtml(lang)}` : ''}">${code}</code></pre></div>`
            );
          }
        );
      }
      return DOMPurify.sanitize(html, PURIFY_OPTS);
    } catch (e) {
      return `<pre class="md-fallback">${escapeHtml(text)}</pre>`;
    }
  }

  function enhanceCodeBlocks(root) {
    if (!root) return;
    root.querySelectorAll('[data-md-copy]').forEach((btn) => {
      if (btn.__mdBound) return;
      btn.__mdBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wrap = btn.closest('.md-code-wrap');
        const codeEl = wrap && wrap.querySelector('code');
        const raw = codeEl ? codeEl.textContent || '' : '';
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(raw);
          } else {
            const ta = document.createElement('textarea');
            ta.value = raw;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          const prev = btn.textContent;
          btn.textContent = t('md.copied');
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = prev || t('md.copy');
            btn.classList.remove('copied');
          }, 1200);
        } catch (_) {
          btn.textContent = t('md.copyFail');
          setTimeout(() => {
            btn.textContent = t('md.copy');
          }, 1200);
        }
      });
    });
  }

  let streamMdTimer = null;
  function scheduleStreamMarkdown(el, text) {
    if (!el) return;
    if (streamMdTimer) cancelAnimationFrame(streamMdTimer);
    streamMdTimer = requestAnimationFrame(() => {
      streamMdTimer = null;
      el.innerHTML = formatMarkdown(text || '');
      enhanceCodeBlocks(el);
    });
  }

  function renderEmpty() {
    messagesEl.innerHTML = `
      <div class="empty">
        <h2>${t('chat.emptyTitle')}</h2>
        <div>${t('chat.emptyBody')}</div>
        <div style="margin-top:14px;font-size:13px;line-height:1.6">
          ${t('chat.emptyHints')}
        </div>
      </div>`;
  }

  function formatToolPayload(val, emptyKey) {
    if (val == null || val === '') return t(emptyKey || 'tool.emptyResult');
    if (typeof val === 'string') return val;
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }

  function toolPhaseLabel(step) {
    if (!step) return '';
    if (step.isError) return t('tool.error');
    if (step.phase === 'result' || step.phase === 'done') return t('tool.done');
    if (step.phase === 'interrupted') return t('tool.interrupted');
    return t('tool.running');
  }

  function toolPhaseClass(step) {
    if (!step) return 'running';
    if (step.isError) return 'error';
    if (step.phase === 'result' || step.phase === 'done') return 'done';
    if (step.phase === 'interrupted') return 'interrupted';
    return 'running';
  }

  /**
   * Compact tool timeline under an assistant bubble.
   * @param {Array} tools
   * @param {{ overflow?: number, open?: boolean }} opts
   */
  function toolsTimelineHtml(tools, opts) {
    const list = Array.isArray(tools) ? tools : [];
    const overflow = (opts && opts.overflow) || 0;
    if (!list.length && !overflow) return '';
    const open = !!(opts && opts.open);
    const n = list.length;
    const summary =
      t('tool.timeline') +
      ' · ' +
      t('tool.count', { n }) +
      (overflow ? ' · ' + t('tool.overflow', { n: overflow }) : '');
    const rows = list
      .map((step, idx) => {
        const name = escapeHtml(step.name || 'tool');
        const phase = toolPhaseClass(step);
        const phaseText = escapeHtml(toolPhaseLabel(step));
        const hasDetail =
          step.input != null ||
          step.result != null ||
          step.phase === 'result' ||
          step.isError;
        const inputText = escapeHtml(
          formatToolPayload(step.input, 'tool.emptyInput')
        );
        const resultText = escapeHtml(
          formatToolPayload(step.result, 'tool.emptyResult')
        );
        const detail = hasDetail
          ? `<div class="tool-step-detail hidden">
              <div class="tool-kv"><span class="k">in</span><pre class="tool-pre">${inputText}</pre></div>
              <div class="tool-kv"><span class="k">out</span><pre class="tool-pre">${resultText}</pre></div>
            </div>`
          : '';
        return `<div class="tool-step phase-${phase}" data-tool-idx="${idx}">
          <button type="button" class="tool-step-head" data-tool-toggle ${hasDetail ? '' : 'disabled'}>
            <span class="tool-dot" aria-hidden="true"></span>
            <span class="tool-name">${name}</span>
            <span class="tool-phase">${phaseText}</span>
          </button>
          ${detail}
        </div>`;
      })
      .join('');
    return `<div class="tool-timeline ${open ? 'is-open' : ''}" data-tool-timeline>
      <button type="button" class="tool-timeline-toggle" data-tool-timeline-toggle>
        <span class="tool-timeline-label">${escapeHtml(summary)}</span>
        <span class="tool-timeline-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
      </button>
      <div class="tool-timeline-body ${open ? '' : 'hidden'}">${rows}</div>
    </div>`;
  }

  function upsertStreamingTool(tool) {
    if (!tool || typeof tool !== 'object') return;
    const phase = tool.phase === 'result' ? 'result' : 'start';
    const id = tool.id ? String(tool.id) : null;
    const name = String(tool.name || 'tool').slice(0, 120);
    let step = null;
    if (id) step = streamingTools.find((x) => x.id === id);
    if (!step && phase === 'result') {
      for (let i = streamingTools.length - 1; i >= 0; i--) {
        const s = streamingTools[i];
        if (s.phase !== 'result' && s.name === name) {
          step = s;
          break;
        }
      }
    }
    if (!step) {
      if (streamingTools.length >= 80) streamingTools.shift();
      step = {
        id,
        name,
        phase: phase === 'result' ? 'result' : 'running',
        input: phase === 'start' ? tool.input : undefined,
        result: phase === 'result' ? tool.result : undefined,
        isError: phase === 'result' ? !!tool.isError : false,
        ts: tool.ts || Date.now(),
        endedAt: phase === 'result' ? tool.endedAt || Date.now() : null,
      };
      streamingTools.push(step);
    } else {
      if (tool.name) step.name = name;
      if (phase === 'start' && tool.input !== undefined) step.input = tool.input;
      if (phase === 'result') {
        step.phase = 'result';
        step.result = tool.result;
        step.isError = !!tool.isError;
        step.endedAt = tool.endedAt || Date.now();
      } else if (step.phase !== 'result') {
        step.phase = 'running';
      }
    }
    if (tool.overflow != null && Number.isFinite(Number(tool.overflow))) {
      streamingToolOverflow = Math.max(
        streamingToolOverflow,
        Number(tool.overflow)
      );
    }
  }

  function applyToolsSnapshot(tools, overflow) {
    if (!Array.isArray(tools)) return;
    streamingTools = tools
      .filter((x) => x && typeof x === 'object')
      .slice(-80)
      .map((x) => ({
        id: x.id ? String(x.id) : null,
        name: String(x.name || 'tool').slice(0, 120),
        phase:
          x.phase === 'result' || x.phase === 'done'
            ? 'result'
            : x.phase === 'interrupted'
              ? 'interrupted'
              : 'running',
        input: x.input,
        result: x.result,
        isError: !!x.isError,
        ts: x.ts || Date.now(),
        endedAt: x.endedAt || null,
      }));
    streamingToolOverflow = Number(overflow) || 0;
  }

  function scheduleToolTimelineRender() {
    if (toolRenderTimer) return;
    toolRenderTimer = requestAnimationFrame(() => {
      toolRenderTimer = null;
      const host = messagesEl.querySelector(
        `.msg.assistant[data-id="${CSS && CSS.escape ? CSS.escape(String(streamingId || '')) : String(streamingId || '')}"] .tool-timeline-host`
      );
      // Fallback without CSS.escape
      let el = host;
      if (!el && streamingId != null) {
        const nodes = messagesEl.querySelectorAll('.msg.assistant.typing .tool-timeline-host, .msg.assistant .tool-timeline-host');
        el = nodes[nodes.length - 1] || null;
      }
      if (el) {
        const wasOpen = !!(
          el.querySelector('.tool-timeline.is-open') ||
          (el.querySelector('.tool-timeline-body') &&
            !el.querySelector('.tool-timeline-body').classList.contains('hidden'))
        );
        el.innerHTML = toolsTimelineHtml(streamingTools, {
          overflow: streamingToolOverflow,
          open: wasOpen || streamingTools.some((s) => s.phase === 'running'),
        });
        scrollToBottom(false);
      } else {
        renderMessages();
      }
    });
  }

  function bubbleHtml(m, { typing } = {}) {
    const role = m.role;
    if (role === 'system') {
      return `<div class="msg system" data-id="${escapeHtml(m.id || '')}">
        <div class="bubble bubble-plain">${escapeHtml(m.content || '')}</div>
      </div>`;
    }
    const canRewind = role === 'user' && m.id && !String(m.id).startsWith('tmp-');
    const actions = canRewind
      ? `<div class="actions"><button type="button" data-rewind-to="${escapeHtml(m.id)}">${t('action.rewindTo')}</button></div>`
      : role === 'assistant' && m.id && !String(m.id).startsWith('tmp-')
        ? `<div class="actions"><button type="button" data-rewind-last="1">${t('action.rewindLast')}</button></div>`
        : '';
    // User: keep mostly plain (escape) but allow light markdown if they paste md
    // Assistant: full markdown
    const body =
      role === 'assistant'
        ? formatMarkdown(m.content || (typing ? '…' : ''))
        : formatMarkdown(m.content || '');
    let toolsHtml = '';
    if (role === 'assistant') {
      const tools =
        typing && streamingId && String(m.id) === String(streamingId)
          ? streamingTools
          : (m.meta && Array.isArray(m.meta.tools) ? m.meta.tools : []);
      const overflow =
        typing && streamingId && String(m.id) === String(streamingId)
          ? streamingToolOverflow
          : (m.meta && m.meta.toolOverflow) || 0;
      const openDefault =
        typing && tools.some((s) => s.phase === 'running' || s.phase === 'start');
      toolsHtml = `<div class="tool-timeline-host">${toolsTimelineHtml(tools, {
        overflow,
        open: openDefault,
      })}</div>`;
    }
    return `
      <div class="msg ${role}${typing ? ' typing' : ''}" data-id="${escapeHtml(m.id || '')}" data-role="${role}">
        <div class="bubble md-body ${typing ? 'typing' : ''}">${body}</div>
        ${toolsHtml}
        <div class="meta">${role === 'user' ? t('common.you') : t('common.claude')}</div>
        ${actions}
      </div>`;
  }

  function renderMessages() {
    if (!messages.length && !streamingId) {
      renderEmpty();
      return;
    }
    let html = messages.map((m) => bubbleHtml(m)).join('');
    if (streamingId != null) {
      // avoid duplicating if assistant_done already upserted same id
      const already = messages.some((m) => m.id === streamingId);
      if (!already) {
        html += bubbleHtml(
          {
            id: streamingId,
            role: 'assistant',
            content: streamingText || '…',
            meta: {
              tools: streamingTools,
              toolOverflow: streamingToolOverflow,
            },
          },
          { typing: true }
        );
      }
    }
    messagesEl.innerHTML = html;
    enhanceCodeBlocks(messagesEl);
    scrollToBottom(true);
  }

  function renderSessions() {
    if (!sessions.length) {
      sessionList.innerHTML = `<div class="muted tiny" style="padding:8px">${t('sidebar.empty')}</div>`;
      return;
    }
    sessionList.innerHTML = sessions
      .map((s) => {
        const active = s.id === currentId ? 'active' : '';
        const titleText = escapeHtml(s.title || t('chat.defaultTitle'));
        const when = s.updatedAt
          ? new Date(s.updatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN')
          : '';
        return `<div class="session-item ${active}" data-id="${s.id}">
          <div class="row">
            <div class="session-main">
              <div class="t">${titleText}</div>
              <div class="s">${escapeHtml(when)} · ${escapeHtml(modeLabel(s.permissionMode))}</div>
            </div>
            <button type="button" class="icon-action del" data-del="${s.id}" title="${escapeHtml(t('common.deleteAria'))}" aria-label="${escapeHtml(t('common.deleteAria'))}">${ICON_TRASH}</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function renderModes() {
    const cur = currentSession()?.permissionMode || meta.defaultPermissionMode;
    modeOptions.innerHTML = (meta.permissionModes || [])
      .map((m) => {
        const active = m.id === cur ? 'active' : '';
        const label = modeLabel(m.id);
        const hint = modeHintText(m.id);
        return `<button type="button" class="mode-opt ${active}" data-mode="${escapeHtml(m.id)}">
          <div class="n">${escapeHtml(label)}</div>
          <div class="h">${escapeHtml(hint)}</div>
        </button>`;
      })
      .join('');
    btnMode.textContent = modeLabel(cur);
    // 同步 HUD 模式文案（不覆盖 sessionStartedAt / usage）
    if (hudMode) {
      hudState.mode = cur;
      hudMode.textContent = modeLabel(cur);
      hudMode.title = t('hud.modePrefix') + cur;
    }
  }

  function renderCommands(filterPrefix) {
    const cmds = meta.commands || [];
    if (!cmds.length) {
      cmdOptions.innerHTML = `<div class="muted tiny">${t('cmd.empty')}</div>`;
      return;
    }
    const q = String(filterPrefix || '')
      .trim()
      .toLowerCase();
    const filtered = !q
      ? cmds
      : cmds.filter((c) => {
          const alias = ((c.aliases && c.aliases[0]) || '/' + c.id).toLowerCase();
          const id = ('/' + (c.id || '')).toLowerCase();
          const summary = String(commandSummary(c) || c.summary || '').toLowerCase();
          const aliases = (c.aliases || []).map((a) => String(a).toLowerCase());
          return (
            alias.startsWith(q) ||
            id.startsWith(q) ||
            aliases.some((a) => a.startsWith(q) || a.includes(q)) ||
            summary.includes(q.replace(/^\//, ''))
          );
        });
    if (!filtered.length) {
      cmdOptions.innerHTML = `<div class="muted tiny">${t('cmd.noMatch')}</div>`;
      return;
    }
    cmdOptions.innerHTML = filtered
      .map((c) => {
        const alias = (c.aliases && c.aliases[0]) || '/' + c.id;
        return `<button type="button" class="cmd-opt" data-cmd="${escapeHtml(alias)}">
          <div class="n">${escapeHtml(alias)}</div>
          <div class="h">${escapeHtml(commandSummary(c))}</div>
        </button>`;
      })
      .join('');
  }

  function currentSession() {
    return sessions.find((s) => s.id === currentId) || null;
  }

  async function loadMeta() {
    meta = await api('/api/meta');
    renderModes();
    renderCommands();
    if (meta.runtime) {
      chatSub.title = `${meta.runtime.user} · ${meta.runtime.settingsPath || ''}`;
    }
    // 仅当本地没存过开关时，跟随服务端默认
    try {
      if (localStorage.getItem(BG_KEY) == null && meta.defaultBackground != null) {
        chkBackground.checked = !!meta.defaultBackground;
      }
    } catch {
      /* ignore */
    }
    // 预加载模型目录（失败不阻塞）
    loadModels().catch(() => {});
  }

  async function loadSessions() {
    const data = await api('/api/sessions');
    sessions = data.sessions || [];
    renderSessions();
  }

  /** 会话切换序号：丢弃过期的慢请求结果 */
  let selectSeq = 0;
  let selectingSession = false;

  async function selectSession(id) {
    if (!id) return;
    // 同一会话再点：只关侧栏，不重复拉
    if (id === currentId && !selectingSession) {
      openSidebar(false);
      hideBottomPanels();
      return;
    }
    const prevId = currentId;
    const seq = ++selectSeq;
    selectingSession = true;
    currentId = id;
    // 立刻刷新列表高亮，体感更快
    renderSessions();
    chatTitle.textContent =
      (sessions.find((s) => s.id === id) || {}).title || t('status.loadingChat');
    chatSub.textContent = t('status.opening');
    setStatus('');
    connectSSE(id);
    let data;
    try {
      data = await api(`/api/sessions/${encodeURIComponent(id)}`, {
        timeoutMs: 60000,
      });
    } catch (e) {
      // 打开失败：若用户已切到别的会话则不动；否则尽量回退
      if (selectSeq === seq && currentId === id) {
        setStatus(e.message || t('msg.openFail'), false);
        if (prevId && prevId !== id) {
          currentId = prevId;
          connectSSE(prevId);
          renderSessions();
        }
        chatSub.textContent = t('status.openFailed');
      }
      if (selectSeq === seq) selectingSession = false;
      return;
    }
    // 慢请求返回时用户可能已点开另一个会话
    if (selectSeq !== seq || currentId !== id) {
      // 不把 selectingSession 置 false：由更新的那次 select 收尾
      return;
    }

    messages = data.messages || [];
    streamingId = null;
    streamingText = '';
    streamingTools = [];
    streamingToolOverflow = 0;
    optimisticId = null;

    // 同步会话级模型覆盖
    if (data.session) {
      sessions = sessions.map((s) =>
        s.id === id ? { ...s, ...data.session } : s
      );
      if (!sessions.find((s) => s.id === id)) sessions.unshift(data.session);
    }

    // HUD：整表替换，避免上一会话的 model/usage 残留
    applyHud(
      {
        sessionStartedAt: (data.session && data.session.createdAt) || Date.now(),
        mode:
          (data.session && data.session.permissionMode) ||
          meta.defaultPermissionMode ||
          null,
        model:
          (data.hud && data.hud.model) ||
          (data.session &&
            (data.session.lastCliModel || data.session.sessionModel)) ||
          null,
        usage:
          (data.hud && data.hud.usage) ||
          (data.session && data.session.lastUsage) ||
          null,
        durationMs:
          (data.hud && data.hud.durationMs) ||
          (data.session && data.session.lastTurnDurationMs) ||
          null,
      },
      { replace: true }
    );
    ensureHudTimer();

    // 重连恢复进行中的后台任务 partial + tools
    if (data.activeJob && data.activeJob.status === 'running') {
      activeJobId = data.activeJob.id;
      streamingId = data.activeJob.assistantId;
      streamingText = data.activeJob.partialText || '';
      if (Array.isArray(data.activeJob.tools) && data.activeJob.tools.length) {
        applyToolsSnapshot(data.activeJob.tools, data.activeJob.toolOverflow);
      }
      setRunning(true, { background: !!data.activeJob.background });
      setStatus(
        data.activeJob.background
          ? t('msg.bgStill')
          : t('msg.jobStill'),
        true
      );
    } else {
      setRunning(!!data.running);
      // 打开绑定了 CLI 的会话时：提示增量同步结果
      if (data.sync && data.sync.appended > 0) {
        setStatus(
          t('msg.syncedFromCli', { n: data.sync.appended }) +
            (data.sync.historyTruncated ? t('msg.onlyRecent') : ''),
          false
        );
      }
    }

    chatTitle.textContent = data.session?.title || t('chat.defaultTitle');
    renderMessages();
    renderSessions();
    renderModes();
    updateModelChip();
    openSidebar(false);
    hideBottomPanels();
    closeModelSheet({ restoreFocus: false });
    closeResumeSheet({ restoreFocus: false });
    selectingSession = false;
    // 桌面：打开会话后焦点回输入框；手机：避免弹键盘抢屏
    if (!isMobileLayout()) focusComposer();
  }

  /** 手动强制从 CLI transcript 增量同步当前/指定会话 */
  async function syncSessionHistory(sessionId) {
    const id = sessionId || currentId;
    if (!id || importingResume) return;
    try {
      setStatus(t('msg.syncingCli'), true);
      const data = await api(`/api/sessions/${encodeURIComponent(id)}/sync`, {
        method: 'POST',
        body: '{}',
        timeoutMs: 60000,
      });
      if (id === currentId) {
        // 优先用服务端广播后的列表；再拉一次 nosync 兜底
        try {
          const full = await api(
            `/api/sessions/${encodeURIComponent(id)}?nosync=1`
          );
          if (currentId === id) {
            messages = full.messages || [];
            renderMessages();
          }
        } catch {
          /* 广播 history_synced 可能已更新 */
        }
      }
      await loadSessions();
      if (data.appended > 0) {
        setStatus(
          t('msg.syncedN', { n: data.appended }) +
            (data.historyTruncated ? t('msg.onlyRecent') : ''),
          false
        );
      } else if (data.reason === 'busy' || data.skipped) {
        setStatus(
          data.reason === 'busy' ? t('msg.syncBusy') : t('msg.syncFresh'),
          false
        );
      } else {
        setStatus(t('msg.syncFresh'), false);
      }
      return data;
    } catch (e) {
      setStatus(e.message || t('msg.syncFail'), false);
      throw e;
    }
  }

  async function newChat() {
    const data = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ permissionMode: meta.defaultPermissionMode }),
    });
    await loadSessions();
    await selectSession(data.session.id);
    inputEl.focus();
  }

  async function deleteSession(id) {
    if (!confirm(t('msg.delChatConfirm'))) return;
    await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (currentId === id) {
      currentId = null;
      messages = [];
      if (es) {
        es.close();
        es = null;
      }
      chatTitle.textContent = 'Claude Phone';
      renderEmpty();
      setRunning(false);
    }
    await loadSessions();
    if (!currentId && sessions[0]) await selectSession(sessions[0].id);
  }

  function connectSSE(sessionId) {
    if (es) {
      try {
        es.onmessage = null;
        es.onerror = null;
        es.close();
      } catch (_) {
        /* ignore */
      }
      es = null;
    }
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/events`;
    es = new EventSource(url);
    const boundId = sessionId;
    es.onmessage = (ev) => {
      // 切换会话后忽略旧连接残留（close 异步）
      if (currentId !== boundId) return;
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleEvent(data);
    };
    es.onerror = () => {
      if (currentId !== boundId) return;
      setStatus(t('msg.sseReconnect'), false);
    };
  }

  function upsertMessage(msg) {
    if (!msg || !msg.id) {
      messages.push(msg);
      return;
    }
    const i = messages.findIndex((m) => m.id === msg.id);
    if (i >= 0) messages[i] = msg;
    else messages.push(msg);
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'hello':
        if (ev.activeJob && ev.activeJob.status === 'running') {
          activeJobId = ev.activeJob.id;
          streamingId = ev.activeJob.assistantId || streamingId;
          if (ev.activeJob.partialText && !streamingText) {
            streamingText = ev.activeJob.partialText;
          }
          if (Array.isArray(ev.activeJob.tools) && ev.activeJob.tools.length) {
            applyToolsSnapshot(ev.activeJob.tools, ev.activeJob.toolOverflow);
          }
          setRunning(true, { background: !!ev.activeJob.background });
          setStatus(
            ev.activeJob.background
              ? t('msg.bgRunningCanClose')
              : t('msg.generating'),
            true
          );
          renderMessages();
        } else {
          setRunning(!!ev.running);
          setStatus(ev.running ? t('msg.generating') : '', !!ev.running);
        }
        break;
      case 'job_started':
        if (ev.job) {
          activeJobId = ev.job.id;
          setRunning(true, { background: !!ev.job.background });
          if (ev.job.background) {
            setStatus(t('msg.bgStarted'), true);
            jobPill.classList.remove('hidden');
          }
        }
        if (ev.permissionMode) {
          setStatus(
            t('msg.runningPerm', { m: modeLabel(ev.permissionMode) }),
            true
          );
        }
        break;
      case 'permission_mode':
        setStatus(
          t('msg.permEffective', { m: ev.label || ev.effective || ev.requested }) +
            (ev.effective && ev.requested && ev.effective !== ev.requested
              ? t('msg.permRequested', { r: ev.requested })
              : ''),
          true
        );
        break;
      case 'job_updated':
        if (ev.job && ev.job.id === activeJobId && ev.job.status !== 'running') {
          jobPill.classList.add('hidden');
        }
        break;
      case 'user_message':
        if (ev.message) {
          if (optimisticId) {
            messages = messages.filter((m) => m.id !== optimisticId);
            optimisticId = null;
          }
          upsertMessage(ev.message);
          renderMessages();
        }
        break;
      case 'system_message':
        if (ev.message) {
          upsertMessage(ev.message);
          renderMessages();
        }
        break;
      case 'rewound':
        messages = ev.messages || [];
        streamingId = null;
        streamingText = '';
        streamingTools = [];
        streamingToolOverflow = 0;
        setRunning(false);
        setStatus(t('msg.rewound'), false);
        if (ev.session) {
          sessions = sessions.map((s) => (s.id === ev.session.id ? ev.session : s));
          chatTitle.textContent = ev.session.title || t('chat.defaultTitle');
          renderModes();
        }
        renderMessages();
        loadSessions();
        break;
      case 'assistant_start':
        streamingId = ev.messageId;
        if (!ev.resume) {
          streamingText = '';
          streamingTools = [];
          streamingToolOverflow = 0;
        }
        if (ev.jobId) activeJobId = ev.jobId;
        if (Array.isArray(ev.tools) && ev.tools.length) {
          applyToolsSnapshot(ev.tools, ev.toolOverflow);
        }
        setRunning(true, { background: !!ev.background || chkBackground.checked });
        setStatus(
          chkBackground.checked
            ? t('msg.thinkingBg')
            : t('msg.thinking'),
          true
        );
        renderMessages();
        break;
      case 'assistant_delta':
        if (ev.messageId === streamingId || streamingId == null) {
          streamingId = ev.messageId;
          // resume 推送的是全量 partial，普通 delta 是增量
          if (ev.resume) streamingText = ev.text || '';
          else streamingText += ev.text || '';
          const bubbles = messagesEl.querySelectorAll('.msg.assistant .bubble.typing');
          const last = bubbles[bubbles.length - 1];
          if (last) {
            scheduleStreamMarkdown(last, streamingText);
            scrollToBottom(false);
          } else {
            renderMessages();
          }
        }
        break;
      case 'tool':
        if (ev.messageId && streamingId && ev.messageId !== streamingId) {
          // 过期 turn 的工具事件丢弃
          break;
        }
        if (ev.messageId && !streamingId) streamingId = ev.messageId;
        upsertStreamingTool(ev.tool || ev);
        setStatus(t('msg.tool', { n: (ev.tool && ev.tool.name) || '…' }), true);
        scheduleToolTimelineRender();
        break;
      case 'tools_snapshot':
        if (ev.messageId) streamingId = ev.messageId;
        applyToolsSnapshot(ev.tools, ev.toolOverflow);
        scheduleToolTimelineRender();
        renderMessages();
        break;
      case 'assistant_done':
        // 若最终消息未带 tools，把本轮流式时间线补进去
        if (ev.message) {
          const msg = ev.message;
          if (
            (!msg.meta || !Array.isArray(msg.meta.tools) || !msg.meta.tools.length) &&
            streamingTools.length
          ) {
            msg.meta = Object.assign({}, msg.meta || {}, {
              tools: streamingTools.slice(),
              toolOverflow: streamingToolOverflow,
            });
          }
          upsertMessage(msg);
        }
        streamingId = null;
        streamingText = '';
        streamingTools = [];
        streamingToolOverflow = 0;
        setRunning(false);
        setStatus('');
        renderMessages();
        loadSessions();
        {
          const patch = {};
          if (ev.usage != null) patch.usage = ev.usage;
          if (ev.model != null) patch.model = ev.model;
          if (ev.durationMs != null) patch.durationMs = ev.durationMs;
          if (Object.keys(patch).length) applyHud(patch);
        }
        // 桌面端生成结束后焦点回输入框，方便连续对话
        if (!isMobileLayout()) focusComposer();
        break;
      case 'hud': {
        // 只合并有值的字段，避免 undefined / 0 占位把已有 model/usage 清掉
        const patch = {};
        if (ev.model != null) patch.model = ev.model;
        if (ev.permissionMode != null || ev.mode != null) {
          patch.mode = ev.permissionMode || ev.mode;
        }
        if (ev.usage != null) {
          const u = ev.usage;
          const meaningful =
            (Number(u.inputTokens) || 0) > 0 ||
            (Number(u.outputTokens) || 0) > 0 ||
            (Number(u.cacheReadInputTokens) || 0) > 0 ||
            (Number(u.cacheCreationInputTokens) || 0) > 0 ||
            (Number(u.contextUsed) || 0) > 0 ||
            (u.contextPct != null &&
              Number.isFinite(Number(u.contextPct)) &&
              Number(u.contextPct) > 0);
          if (meaningful) patch.usage = u;
        }
        if (ev.durationMs != null) patch.durationMs = ev.durationMs;
        if (ev.sessionStartedAt != null) {
          patch.sessionStartedAt = ev.sessionStartedAt;
        }
        if (Object.keys(patch).length) applyHud(patch);
        break;
      }
      case 'status':
        setRunning(ev.state === 'running');
        if (ev.state === 'running') setStatus(t('msg.generating'), true);
        else if (statusLine.textContent && statusLine.textContent !== t('msg.rewound') && !/已回退|Rewound/i.test(statusLine.textContent)) setStatus('');
        break;
      case 'aborted':
        setRunning(false);
        setStatus(t('msg.stopped'), false);
        streamingId = null;
        // keep tools on last assistant bubble if already done-upserted;
        // clear live stream buffer so next turn starts clean
        streamingTools = [];
        streamingToolOverflow = 0;
        break;
      case 'error':
        setStatus(ev.message || t('msg.error'), false);
        break;
      case 'session_updated':
        if (ev.session) {
          sessions = sessions.map((s) =>
            s.id === ev.session.id ? { ...s, ...ev.session } : s
          );
          if (currentId === ev.session.id) {
            chatTitle.textContent = ev.session.title || t('chat.defaultTitle');
            renderModes();
            updateModelChip();
          }
          renderSessions();
        }
        break;
      case 'open_model_picker':
        openModelSheet();
        break;
      case 'open_resume_picker':
        openResumeSheet();
        break;
      case 'session_imported':
        // /resume <id> 从服务端导入后：刷新列表并切到新会话
        if (ev.session && ev.session.id) {
          loadSessions()
            .then(() => selectSession(ev.session.id))
            .catch((err) => {
              setStatus((err && err.message) || t('msg.importSwitchFail'), false);
            });
        }
        break;
      case 'history_synced':
        if (ev.messages) {
          messages = ev.messages;
          renderMessages();
        }
        if (ev.appended > 0) {
          setStatus(t('msg.syncedFromCli', { n: ev.appended }), false);
        }
        loadSessions().catch(() => {});
        break;
      default:
        break;
    }
  }

  let sending = false;

  async function sendMessage(textOverride) {
    const text = (textOverride != null ? textOverride : inputEl.value).trim();
    if (!text || running || sending) return;
    // 纯 /model 打开选择器，不发往服务端冒泡
    if (text === '/model' || text === '/models') {
      if (textOverride == null) {
        inputEl.value = '';
        autoGrow();
        btnSend.disabled = true;
      }
      openModelSheet();
      return;
    }
    // 纯 /resume|/import 打开本机会话导入（带参数仍走服务端）
    if (
      text === '/resume' ||
      text === '/import' ||
      text === '/resume ' ||
      text === '/import '
    ) {
      if (textOverride == null) {
        inputEl.value = '';
        autoGrow();
        btnSend.disabled = true;
      }
      openResumeSheet();
      return;
    }
    // 纯 /sync 强制同步当前导入会话
    if (text === '/sync') {
      if (textOverride == null) {
        inputEl.value = '';
        autoGrow();
        btnSend.disabled = true;
      }
      if (!currentId) {
        setStatus(t('msg.pleaseOpenChat'), false);
        return;
      }
      syncSessionHistory(currentId).catch(() => {});
      return;
    }
    sending = true;
    btnSend.disabled = true;
    if (!currentId) {
      try {
        await newChat();
      } catch (e) {
        sending = false;
        btnSend.disabled = !inputEl.value.trim();
        setStatus(e.message || t('msg.createFail'), false);
        return;
      }
    }
    // 清空输入（仅用户键入路径）；失败时再还原
    let clearedFromInput = false;
    if (textOverride == null) {
      inputEl.value = '';
      autoGrow();
      clearedFromInput = true;
    }
    hidePanels();

    optimisticId = 'tmp-' + Date.now();
    messages.push({
      id: optimisticId,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    });
    renderMessages();
    // 发送后立刻进入“等待响应”体感（SSE job_started 会再确认）
    setRunning(true, { background: !!chkBackground.checked });
    setStatus(
      chkBackground.checked ? t('msg.submittedBg') : t('msg.submittedWait'),
      true
    );

    try {
      const res = await api(`/api/sessions/${encodeURIComponent(currentId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: text,
          background: !!chkBackground.checked,
        }),
      });
      if (res.jobId) activeJobId = res.jobId;
      // 本地命令：不会有 assistant 流，刷新列表
      if (res.local) {
        optimisticId = null;
        const data = await api(`/api/sessions/${encodeURIComponent(currentId)}`);
        if (currentId === (data.session && data.session.id) || data.messages) {
          messages = data.messages || [];
        }
        setRunning(false);
        renderMessages();
        loadSessions();
        // 本地命令后焦点回输入框
        focusComposer();
      } else if (res.background) {
        setStatus(t('msg.bgSubmitted'), true);
        jobPill.classList.remove('hidden');
        jobPill.textContent = t('composer.jobPillLong');
      }
    } catch (e) {
      if (optimisticId) {
        messages = messages.filter((m) => m.id !== optimisticId);
        optimisticId = null;
        renderMessages();
      }
      // 失败时还原输入，避免用户重打
      if (clearedFromInput && !inputEl.value) {
        inputEl.value = text;
        autoGrow();
      }
      setRunning(false);
      if (e.status === 409) setStatus(t('msg.stillGenerating'), false);
      else setStatus(e.message || t('msg.sendFail'), false);
      focusComposer();
    } finally {
      sending = false;
      btnSend.disabled = running || !inputEl.value.trim();
    }
  }

  async function stopTurn() {
    if (!currentId || !running) return;
    setStatus(t('msg.stopping'), true);
    btnStop.disabled = true;
    try {
      await api(`/api/sessions/${encodeURIComponent(currentId)}/abort`, {
        method: 'POST',
        body: '{}',
      });
    } catch (e) {
      setStatus(e.message || t('msg.stopFail'), false);
    } finally {
      btnStop.disabled = false;
    }
  }

  async function setMode(mode) {
    if (!currentId) {
      meta.defaultPermissionMode = mode;
      renderModes();
      hidePanels();
      applyHud({ mode });
      return;
    }
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(currentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissionMode: mode }),
      });
      const pm = data.session?.permissionMode || mode;
      sessions = sessions.map((s) =>
        s.id === currentId ? { ...s, permissionMode: pm } : s
      );
      renderModes();
      hidePanels();
      applyHud({ mode: pm });
      setStatus(t('mode.set', { m: modeLabel(pm) }), false);
    } catch (e) {
      setStatus(e.message || t('mode.switchFail'), false);
    }
  }

  async function rewindLast() {
    if (!currentId || running) return;
    if (!confirm(t('msg.rewindConfirmLast'))) return;
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(currentId)}/rewind`, {
        method: 'POST',
        body: JSON.stringify({ turns: 1 }),
      });
      messages = data.messages || [];
      renderMessages();
      loadSessions();
    } catch (e) {
      setStatus(e.message || t('msg.rewindFail'), false);
    }
  }

  async function rewindTo(messageId) {
    if (!currentId || running) return;
    if (!confirm(t('msg.rewindConfirmTo'))) return;
    try {
      // 回退到「该条之前」= keep 上一条
      const idx = messages.findIndex((m) => m.id === messageId);
      const keepId = idx > 0 ? messages[idx - 1].id : null;
      const data = await api(`/api/sessions/${encodeURIComponent(currentId)}/rewind`, {
        method: 'POST',
        body: JSON.stringify(keepId ? { messageId: keepId } : { turns: 999 }),
      });
      // 若 keepId null 用 clear 语义：turns 大
      if (!keepId) {
        await sendMessage('/clear');
        return;
      }
      messages = data.messages || [];
      renderMessages();
      loadSessions();
    } catch (e) {
      setStatus(e.message || t('msg.rewindFail'), false);
    }
  }

  // events
  // 首屏静态文案 + 主题/语言控件
  applyStaticI18n();
  updateThemeChrome();
  updateLangChrome();
  const btnTheme = $('btn-theme');
  const btnLang = $('btn-lang');
  if (btnTheme) btnTheme.addEventListener('click', () => cycleTheme());
  if (btnLang) btnLang.addEventListener('click', () => cycleLang());

  if (btnMenu) btnMenu.setAttribute('aria-expanded', 'false');
  btnMenu.addEventListener('click', () => {
    const willOpen = sidebar.classList.contains('hidden');
    openSidebar(willOpen);
  });
  btnCloseSidebar.addEventListener('click', () => openSidebar(false));
  sidebarMask.addEventListener('click', () => openSidebar(false));
  btnNewChat.addEventListener('click', () => {
    if (sending || selectingSession) return;
    newChat().catch((e) => setStatus(e.message || t('msg.newChatFail'), false));
  });
  if (btnImportSession) {
    btnImportSession.addEventListener('click', () => {
      openSidebar(false);
      openResumeSheet();
    });
  }
  btnSend.addEventListener('click', () => sendMessage());
  btnStop.addEventListener('click', () => stopTurn());
  btnMode.addEventListener('click', () => {
    const open = modePanel.classList.contains('hidden');
    hideBottomPanels();
    closeModelSheet({ restoreFocus: false });
    closeResumeSheet({ restoreFocus: false });
    if (open) modePanel.classList.remove('hidden');
  });
  btnCmd.addEventListener('click', () => {
    const open = cmdPanel.classList.contains('hidden');
    hideBottomPanels();
    closeModelSheet({ restoreFocus: false });
    closeResumeSheet({ restoreFocus: false });
    if (open) {
      renderCommands(
        (inputEl.value || '').trim().startsWith('/')
          ? (inputEl.value || '').trim().split(/\s/)[0]
          : ''
      );
      cmdPanel.classList.remove('hidden');
    }
  });
  btnSettings.addEventListener('click', () => {
    const open = settingsPanel.classList.contains('hidden');
    hideBottomPanels();
    closeModelSheet({ restoreFocus: false });
    closeResumeSheet({ restoreFocus: false });
    if (open) {
      settingsPanel.classList.remove('hidden');
      loadSettings();
    }
  });
  btnSettingsSave.addEventListener('click', () => saveSettings());
  btnSettingsReload.addEventListener('click', () => loadSettings());

  // Model sheet
  if (btnModel) {
    btnModel.addEventListener('click', () => {
      if (isSheetOpen(modelSheet)) closeModelSheet();
      else openModelSheet();
    });
  }
  if (btnModelClose) btnModelClose.addEventListener('click', () => closeModelSheet());
  if (modelSheetMask) modelSheetMask.addEventListener('click', () => closeModelSheet());
  if (modelSearch) {
    modelSearch.addEventListener('input', () => {
      modelFilter = modelSearch.value || '';
      renderModelList();
    });
    modelSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModelSheet();
      }
    });
  }
  document.querySelectorAll('.scope-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      modelScope = tab.getAttribute('data-scope') || 'session';
      document.querySelectorAll('.scope-tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderModelList();
    });
  });
  if (modelList) {
    const onModelListActivate = (e) => {
      const del = e.target.closest('[data-del-model]');
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        deleteCustomModelUI(del.getAttribute('data-del-model'));
        return true;
      }
      const item = e.target.closest('[data-model-id]');
      // Ignore activate when the event originated on a nested control already handled
      if (item && !e.target.closest('[data-del-model]')) {
        selectModel(item.getAttribute('data-model-id'));
        return true;
      }
      return false;
    };
    modelList.addEventListener('click', (e) => {
      onModelListActivate(e);
    });
    modelList.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target.closest('[data-del-model], [data-model-id]');
      if (!target) return;
      // Space on role=button should not scroll
      e.preventDefault();
      onModelListActivate({
        target: e.target,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
      });
    });
  }
  if (btnModelAdd) btnModelAdd.addEventListener('click', () => addCustomModelUI());
  if (modelCustomId) {
    modelCustomId.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (modelCustomLabel) modelCustomLabel.focus();
        else addCustomModelUI();
      }
    });
  }
  if (modelCustomLabel) {
    modelCustomLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomModelUI();
      }
    });
  }

  // Resume sheet
  if (btnResumeClose) btnResumeClose.addEventListener('click', () => closeResumeSheet());
  if (resumeSheetMask) resumeSheetMask.addEventListener('click', () => closeResumeSheet());
  if (resumeSearch) {
    resumeSearch.addEventListener('input', () => {
      resumeFilter = resumeSearch.value || '';
      renderResumeList();
    });
    resumeSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeResumeSheet();
      }
    });
  }
  if (resumeList) {
    function triggerResumeSync(webId) {
      if (!webId || importingResume) return;
      importingResume = true;
      if (resumeSheetMsg) resumeSheetMsg.textContent = t('resume.syncing');
      renderResumeList();
      syncSessionHistory(webId)
        .then(async () => {
          closeResumeSheet();
          if (webId !== currentId) await selectSession(webId);
        })
        .catch(() => {
          if (resumeSheetMsg) resumeSheetMsg.textContent = t('resume.syncFail');
        })
        .finally(() => {
          importingResume = false;
          if (resumeSheet && !resumeSheet.hidden) renderResumeList();
        });
    }
    const onResumeListActivate = (e) => {
      const sync = e.target.closest('[data-sync-web]');
      if (sync) {
        e.preventDefault();
        e.stopPropagation();
        triggerResumeSync(sync.getAttribute('data-sync-web'));
        return;
      }
      const item = e.target.closest('[data-claude-session]');
      if (!item || item.disabled) return;
      // Nested sync control already handled above
      if (e.target.closest('[data-sync-web]')) return;
      importOrOpenResume(
        item.getAttribute('data-claude-session'),
        item.getAttribute('data-web-session') || '',
        item.getAttribute('data-imported') === '1'
      );
    };
    resumeList.addEventListener('click', onResumeListActivate);
    resumeList.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (!e.target.closest('[data-sync-web], [data-claude-session]')) return;
      e.preventDefault();
      onResumeListActivate(e);
    });
  }

  // Escape：按层级关闭；全局快捷键
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dismissTopLayer()) {
        e.preventDefault();
      }
      return;
    }
    // Ctrl/Cmd+Enter 发送（输入框内 Enter 另有处理）
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (document.activeElement === inputEl) {
        e.preventDefault();
        sendMessage();
      }
    }
  });

  sessionList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      deleteSession(del.getAttribute('data-del'));
      return;
    }
    const item = e.target.closest('.session-item');
    if (item) selectSession(item.getAttribute('data-id'));
  });

  modeOptions.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-mode]');
    if (opt) setMode(opt.getAttribute('data-mode'));
  });

  cmdOptions.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-cmd]');
    if (!opt) return;
    const cmd = opt.getAttribute('data-cmd');
    hideBottomPanels();
    // 点选命令后清掉输入框里残留的 /
    if ((inputEl.value || '').trim().startsWith('/')) {
      inputEl.value = '';
      autoGrow();
      btnSend.disabled = true;
    }
    if (cmd === '/rewind' || cmd === '/rw' || cmd === '/undo') {
      rewindLast();
      return;
    }
    if (cmd === '/help' || cmd === '/clear' || cmd === '/status' || cmd === '/compact') {
      sendMessage(cmd);
      return;
    }
    if (cmd === '/model') {
      openModelSheet();
      return;
    }
    if (cmd === '/resume' || cmd === '/import') {
      openResumeSheet();
      return;
    }
    if (cmd === '/sync') {
      if (currentId) syncSessionHistory(currentId).catch(() => {});
      else setStatus(t('msg.pleaseOpenChat'), false);
      return;
    }
    // 需要参数的：填入输入框
    inputEl.value = cmd + ' ';
    autoGrow();
    btnSend.disabled = running || !inputEl.value.trim();
    focusComposer();
  });

  messagesEl.addEventListener('click', (e) => {
    // Tool timeline expand/collapse
    const timelineToggle = e.target.closest('[data-tool-timeline-toggle]');
    if (timelineToggle) {
      e.preventDefault();
      const root = timelineToggle.closest('[data-tool-timeline]');
      if (!root) return;
      const body = root.querySelector('.tool-timeline-body');
      const caret = root.querySelector('.tool-timeline-caret');
      const open = root.classList.toggle('is-open');
      if (body) body.classList.toggle('hidden', !open);
      if (caret) caret.textContent = open ? '▾' : '▸';
      return;
    }
    const stepToggle = e.target.closest('[data-tool-toggle]');
    if (stepToggle && !stepToggle.disabled) {
      e.preventDefault();
      const step = stepToggle.closest('.tool-step');
      if (!step) return;
      const detail = step.querySelector('.tool-step-detail');
      if (!detail) return;
      detail.classList.toggle('hidden');
      step.classList.toggle('is-open');
      return;
    }

    const to = e.target.closest('[data-rewind-to]');
    if (to) {
      if (running) {
        setStatus(t('msg.rewindWhileRunning'), false);
        return;
      }
      rewindTo(to.getAttribute('data-rewind-to'));
      return;
    }
    const last = e.target.closest('[data-rewind-last]');
    if (last) {
      if (running) {
        setStatus(t('msg.rewindWhileRunning'), false);
        return;
      }
      rewindLast();
    }
  });

  inputEl.addEventListener('input', () => {
    autoGrow();
    btnSend.disabled = running || sending || !inputEl.value.trim();
    const raw = inputEl.value || '';
    const trimmedStart = raw.trimStart();
    if (trimmedStart.startsWith('/')) {
      // 进入 slash 模式：关其它面板，开命令面板并按前缀过滤
      modePanel.classList.add('hidden');
      if (settingsPanel) settingsPanel.classList.add('hidden');
      closeModelSheet({ restoreFocus: false });
      closeResumeSheet({ restoreFocus: false });
      const keepOpen = updateCommandFilterFromInput();
      if (keepOpen || trimmedStart === '/' || !trimmedStart.includes(' ')) {
        cmdPanel.classList.remove('hidden');
      }
    } else if (!cmdPanel.classList.contains('hidden') && !trimmedStart) {
      // 清空输入后收起因 / 打开的命令面板
      cmdPanel.classList.add('hidden');
      renderCommands('');
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dismissTopLayer()) {
        e.preventDefault();
        return;
      }
      // 输入框有内容时 Esc 不强制清空，避免误触；仅收面板
      return;
    }
    // 命令面板打开时：ArrowDown 聚焦第一条命令
    if (
      e.key === 'ArrowDown' &&
      !cmdPanel.classList.contains('hidden') &&
      (inputEl.value || '').trimStart().startsWith('/')
    ) {
      const first = cmdOptions.querySelector('.cmd-opt');
      if (first) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // 移动端输入法组合中不发送
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      sendMessage();
    }
  });

  // 命令列表键盘：Enter 选中，Esc 回输入框
  cmdOptions.addEventListener('keydown', (e) => {
    const items = Array.prototype.slice.call(
      cmdOptions.querySelectorAll('.cmd-opt')
    );
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[Math.min(items.length - 1, Math.max(0, idx) + 1)];
      if (next) next.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx <= 0) {
        focusComposer();
      } else {
        items[idx - 1].focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideBottomPanels();
      focusComposer();
    }
  });

  // 点击消息区空白：收起底部面板（不关 sheet——sheet 有 mask）
  messagesEl.addEventListener('click', (e) => {
    if (e.target === messagesEl || e.target.classList.contains('empty')) {
      hideBottomPanels();
    }
  });

  // 可视区变化：iOS 软键盘顶起时尽量保持输入可见
  if (window.visualViewport) {
    let vvTimer = null;
    window.visualViewport.addEventListener('resize', () => {
      if (vvTimer) cancelAnimationFrame(vvTimer);
      vvTimer = requestAnimationFrame(() => {
        if (document.activeElement === inputEl) {
          try {
            inputEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } catch {
            /* ignore */
          }
        }
      });
    });
  }

  (async function boot() {
    try {
      ensureHudTimer();
      await loadMeta();
      applyHud({ mode: meta.defaultPermissionMode });
      await loadSessions();
      if (sessions[0]) await selectSession(sessions[0].id);
      else await newChat();
      renderHud();
      btnSend.disabled = running || !inputEl.value.trim();
    } catch (e) {
      chatSub.textContent = t('msg.loadFail', { m: e.message || e });
      renderEmpty();
    }
  })();
})();
