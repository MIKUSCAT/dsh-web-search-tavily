export const zh = {
  title: '混合搜索', summary: 'Tavily、Exa、Brave，一处管理搜索与额度。',
  control: '搜索由你掌控', controlSub: '选择来源，设定强度，随时查看消耗。',
  activate: '设为 DSH 网页搜索', inactive: 'DSH 当前选择了其他搜索提供方',
  enabled: '搜索已开启', disabled: '搜索已暂停', refresh: '刷新', loading: '正在读取搜索设置…', unavailable: '搜索设置暂不可用', retry: '重试',
  today: '今日请求', configured: '已配置', providers: '搜索来源', turn: '最近一轮', requests: '次请求', credits: 'credits', noTurn: '还没有搜索',
  strategy: '搜索策略', priority: '优先使用一家', priorityDesc: '按下方顺序选择已配置的来源', blend: '多家混合', blendDesc: '同时检索，合并来源并去重', blendCount: '每次查询使用', two: '两家来源', three: '三家来源',
  fallback: '失败时切换下一家', fallbackDesc: '切换产生的新请求也计入预算', strength: '搜索强度', basic: '均衡 · 1 credit', advanced: '深入 · 2 credits', fast: '快速 · 1 credit', ultraFast: '极速 · 1 credit',
  exaStrength: 'Exa 搜索模式', lite: 'Lite · 低成本', auto: 'Auto · 均衡', deep: 'Deep · 深入', modelDepth: '允许模型调整 Tavily 强度',
  locked: '手动强度已锁定', modelAllowed: '模型可在预算内选择强度', budget: '预算与结果', turnRequests: '每轮最多请求', turnCredits: '每轮 Tavily 上限', dailyRequests: '每日最多请求', results: '每次最多来源',
  zeroUnlimited: '填 0 表示不设本地上限', saved: '设置已保存', unsaved: '有未保存的设置', save: '保存设置', saving: '保存中…', discard: '放弃修改', conflict: '设置已被其他页面修改，草稿已保留。刷新后重新核对。',
  key: 'API Key', keyPlaceholder: '输入或粘贴 API Key', keepKey: '已保存；留空保持当前 Key', saveKey: '保存 Key', removeKey: '移除已保存 Key', keySaved: 'Key 已保存，下一次请求生效', keyRemoved: '已移除保存的 Key',
  inheritedKey: '当前仍有环境变量或旧配置提供 Key', notConfigured: '未配置', stored: 'DSH 凭据', environment: '环境配置', legacy: '旧版配置', keyRequired: '先填写或保存 API Key',
  test: '测试连接', testSearch: '测试搜索 · 1 次', testing: '测试中…', testAuthOk: '认证连接成功', testSearchOk: '搜索成功', testFailed: '连接失败', draftTest: '当前输入的 Key',
  refreshUsage: '刷新额度', refreshLocal: '刷新记录', dashboard: '打开控制台', monthlyLocal: '本插件月上限', localRequests: '本插件本月请求', localCredits: '本插件本月用量', estimatedCost: '本插件费用估计',
  plan: '当前套餐', accountUsage: '账户套餐用量', keyUsage: '当前 Key 用量', paygo: '按量付费用量', remaining: '剩余', noLimit: '未设上限', waitUsage: '读取额度后显示套餐与用量', waitBrave: '测试搜索后读取官方配额',
  unconfirmed: '含未确认消耗的请求', costMissing: '部分请求未返回费用',
  noBalance: '账户余额请在 Exa 控制台查看', localOnly: '本地记录仅统计此插件', quotaHeaders: '官方配额 · 最近一次响应', resetAt: '重置时间', updated: '更新于',
  sourceOn: '启用来源', moveUp: '提高优先级', moveDown: '降低优先级',
  more: '更多选项', topic: '搜索类别', general: '综合', news: '新闻', finance: '金融', timeRange: '时间范围', anytime: '不限', day: '一天', week: '一周', month: '一月', year: '一年',
  includeDomains: '仅搜索这些域名', excludeDomains: '排除这些域名', domainsPlaceholder: '每行一个域名', cache: '结果缓存（秒）', timeout: '超时（毫秒）', chunks: 'Tavily 每来源片段', braveInterval: 'Brave 请求间隔（毫秒）',
  answer: '附带 Tavily 生成的答案', sourceCount: '已启用来源', noSource: '至少启用一家来源并保存对应的 Key',
  invalidNumber: '请填写范围内的整数', invalidDomains: '域名请勿包含协议、路径或空格', unknownError: '操作未完成，请重试',
  errorCredential: 'Key 无效、未配置或没有访问权限', errorQuota: '服务商额度不足或请求过于频繁', errorNetwork: '无法连接供应商，请检查 DSH 网络与代理', errorBudget: '已达到你设置的本地预算', errorTimeout: '连接超时，已发送的请求可能消耗额度',
  errorStorage: '用量记录无法读写，请检查 DSH 目录', errorResponse: '供应商返回了无法识别的数据', errorCancelled: '操作已取消', errorConfig: '配置无效，请检查填写内容'
};
export type Key = keyof typeof zh;
export type T = (key: Key) => string;
export const en: Record<Key, string> = {
  title: 'Hybrid Search', summary: 'Manage Tavily, Exa and Brave search in one place.',
  control: 'Your search, your budget', controlSub: 'Choose sources, set depth, and see what you use.',
  activate: 'Use for DSH web search', inactive: 'DSH currently uses another search provider',
  enabled: 'Search is on', disabled: 'Search is paused', refresh: 'Refresh', loading: 'Loading search settings…', unavailable: 'Search settings are unavailable', retry: 'Retry',
  today: 'Requests today', configured: 'Configured', providers: 'Search providers', turn: 'Latest turn', requests: 'requests', credits: 'credits', noTurn: 'No searches yet',
  strategy: 'Search strategy', priority: 'Use one provider', priorityDesc: 'Choose a configured source in priority order', blend: 'Blend providers', blendDesc: 'Search together, merge and deduplicate', blendCount: 'Providers per query', two: 'Two providers', three: 'Three providers',
  fallback: 'Try the next provider on failure', fallbackDesc: 'Every additional request counts toward your budget', strength: 'Tavily search depth', basic: 'Basic · 1 credit', advanced: 'Advanced · 2 credits', fast: 'Fast · 1 credit', ultraFast: 'Ultra-fast · 1 credit',
  exaStrength: 'Exa search mode', lite: 'Lite · lower cost', auto: 'Auto · balanced', deep: 'Deep · thorough', modelDepth: 'Let the model adjust Tavily depth',
  locked: 'Manual depth is locked', modelAllowed: 'Model chooses depth within your budget', budget: 'Budgets and results', turnRequests: 'Requests per turn', turnCredits: 'Tavily credits per turn', dailyRequests: 'Requests per day', results: 'Sources per query',
  zeroUnlimited: '0 means no local limit', saved: 'Settings saved', unsaved: 'Unsaved settings', save: 'Save settings', saving: 'Saving…', discard: 'Discard', conflict: 'Another page changed these settings. Your draft was kept. Refresh and review it.',
  key: 'API key', keyPlaceholder: 'Paste an API key', keepKey: 'Saved; leave blank to keep it', saveKey: 'Save key', removeKey: 'Remove saved key', keySaved: 'Key saved; applies to the next request', keyRemoved: 'Saved key removed',
  inheritedKey: 'An environment or legacy key is still configured', notConfigured: 'Not configured', stored: 'DSH credentials', environment: 'Environment', legacy: 'Legacy settings', keyRequired: 'Enter or save an API key first',
  test: 'Test connection', testSearch: 'Test search · 1 request', testing: 'Testing…', testAuthOk: 'Authentication works', testSearchOk: 'Search works', testFailed: 'Connection failed', draftTest: 'Current key draft',
  refreshUsage: 'Refresh quota', refreshLocal: 'Refresh records', dashboard: 'Open dashboard', monthlyLocal: 'Local monthly limit', localRequests: 'Plugin requests this month', localCredits: 'Plugin usage this month', estimatedCost: 'Plugin cost estimate',
  plan: 'Plan', accountUsage: 'Account plan usage', keyUsage: 'Current key usage', paygo: 'Pay-as-you-go usage', remaining: 'Remaining', noLimit: 'No limit', waitUsage: 'Refresh quota to see your plan and usage', waitBrave: 'Run a test search to read the official quota',
  unconfirmed: 'Includes requests with unconfirmed usage', costMissing: 'Some requests did not report a cost',
  noBalance: 'See your account balance in the Exa dashboard', localOnly: 'Local counters cover this plugin only', quotaHeaders: 'Official quota · latest response', resetAt: 'Resets', updated: 'Updated',
  sourceOn: 'Enable provider', moveUp: 'Move up', moveDown: 'Move down',
  more: 'More options', topic: 'Search category', general: 'General', news: 'News', finance: 'Finance', timeRange: 'Date range', anytime: 'Any time', day: 'Day', week: 'Week', month: 'Month', year: 'Year',
  includeDomains: 'Include domains', excludeDomains: 'Exclude domains', domainsPlaceholder: 'One hostname per line', cache: 'Cache lifetime (seconds)', timeout: 'Timeout (milliseconds)', chunks: 'Tavily chunks per source', braveInterval: 'Brave interval (milliseconds)',
  answer: 'Include a Tavily-generated answer', sourceCount: 'Enabled providers', noSource: 'Enable a provider and save its API key',
  invalidNumber: 'Enter a whole number within the allowed range', invalidDomains: 'Use hostnames without protocol, path or spaces', unknownError: 'The operation failed; please retry',
  errorCredential: 'The key is missing, invalid or lacks access', errorQuota: 'Provider quota or rate limit reached', errorNetwork: 'Cannot reach the provider; check the DSH network and proxy', errorBudget: 'Your local search budget has been reached', errorTimeout: 'Timed out; sent requests may have consumed quota',
  errorStorage: 'Cannot read or save usage in the DSH directory', errorResponse: 'The provider returned unrecognized data', errorCancelled: 'Cancelled', errorConfig: 'Invalid settings; check the entered values'
};

export function errorText(error: unknown, t: T): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const keys: Record<string, Key> = {
    WEB_PROVIDER_CREDENTIAL_MISSING: 'errorCredential', WEB_RATE_LIMITED: 'errorQuota', WEB_NETWORK_ERROR: 'errorNetwork',
    WEB_BUDGET_EXHAUSTED: 'errorBudget', WEB_TIMEOUT: 'errorTimeout', WEB_USAGE_STORAGE_ERROR: 'errorStorage',
    WEB_INVALID_RESPONSE: 'errorResponse', WEB_RESPONSE_TOO_LARGE: 'errorResponse', WEB_ABORTED: 'errorCancelled',
    WEB_INVALID_REQUEST: 'errorConfig', WEB_CONFIG_CONFLICT: 'conflict'
  };
  return t(keys[code] ?? 'unknownError');
}
