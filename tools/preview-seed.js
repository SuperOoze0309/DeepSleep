/* 预览种子脚本：由 tools/preview.mjs 注入到 index.html 的 <head> 中。
   仅在带 ?demo= 参数时生效，用于在桌面浏览器/无头 Chrome 里检查界面。 */
(function () {
  var p = new URLSearchParams(location.search);
  var demo = p.get('demo');
  if (!demo) return;
  var theme = p.get('theme') || 'light';
  var scheme = p.get('scheme') || 'blue';

  localStorage.clear();
  localStorage.setItem('ds.settings.v1', JSON.stringify({
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-demo-key-for-preview',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    modelCustom: '',
    thinking: true,
    effort: 'high',
    temperature: 1,
    maxTokens: null,
    systemPrompt: '',
    webSearch: false,
    searchProvider: 'duckduckgo',
    tavilyKey: '',
    theme: theme,
    scheme: scheme,
    accentColor: p.get('accent') || '',
    fontScale: 1,
    apiFormat: 'openai',
    activeProviderId: 'p1',
    providers: [
      { id: 'p1', name: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-demo-key-for-preview', model: 'deepseek-flash',
        models: ['deepseek-flash', 'deepseek-v4-pro'], modelCustom: '', format: 'openai' },
      { id: 'p2', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-demo', model: 'claude-sonnet-4-5',
        models: ['claude-sonnet-4-5', 'claude-opus-4-1'], modelCustom: '', format: 'anthropic' },
      { id: 'p3', name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '', model: 'deepseek-ai/DeepSeek-V3',
        models: ['deepseek-ai/DeepSeek-V3'], modelCustom: '', format: 'openai' }
    ]
  }));

  if (demo === 'home' || demo === 'stream') return;

  var IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
    '<rect width="320" height="180" fill="#dfe6f5"/>' +
    '<circle cx="90" cy="70" r="34" fill="#4D6BFE" opacity="0.75"/>' +
    '<rect x="150" y="46" width="130" height="14" rx="7" fill="#9fb0d8"/>' +
    '<rect x="150" y="72" width="96" height="14" rx="7" fill="#9fb0d8"/>' +
    '<text x="160" y="140" font-family="sans-serif" font-size="15" fill="#5b6b8c">示例图片</text></svg>');

  var REASONING = [
    '用户想要一个关于快速排序的说明，并要求给出 Python 实现。',
    '我需要先解释分治思想，再说明基准值的选择对性能的影响。',
    '复杂度方面：平均 O(n log n)，最坏 O(n²)（已排序数组 + 固定基准）。',
    '实现上给出一个原地分区版本，并补充一个更易读的版本。',
    '最后提醒一下 Python 递归深度与随机化基准的实践建议。'
  ].join('\n');

  var ANSWER = [
    '## 快速排序（Quicksort）',
    '',
    '快速排序是一种**分治**排序算法：选一个基准值（pivot），把数组分成“小于基准”和“大于基准”两部分，再对两部分递归排序。',
    '',
    '### 核心步骤',
    '',
    '1. 选择基准值 `pivot`',
    '2. 分区（partition）：把小于基准的元素移到左边',
    '3. 对左右两个子数组递归执行 1–2',
    '',
    '> 关键点：分区是否平衡决定了性能。随机化基准可以把最坏情况的概率降到极低。',
    '',
    '### Python 实现（原地分区）',
    '',
    '```python',
    'import random',
    '',
    'def quicksort(a, lo=0, hi=None):',
    '    if hi is None:',
    '        hi = len(a) - 1',
    '    if lo >= hi:',
    '        return a',
    '    # 随机化基准，避免已排序输入退化',
    '    p = random.randint(lo, hi)',
    '    a[lo], a[p] = a[p], a[lo]',
    '    pivot, i = a[lo], lo',
    '    for j in range(lo + 1, hi + 1):',
    '        if a[j] < pivot:',
    '            i += 1',
    '            a[i], a[j] = a[j], a[i]',
    '    a[lo], a[i] = a[i], a[lo]',
    '    quicksort(a, lo, i - 1)',
    '    quicksort(a, i + 1, hi)',
    '    return a',
    '',
    'print(quicksort([5, 2, 9, 1, 5, 6]))  # [1, 2, 5, 5, 6, 9]',
    '```',
    '',
    '### 复杂度对比',
    '',
    '| 情况 | 时间复杂度 | 空间复杂度 | 说明 |',
    '| --- | --- | --- | --- |',
    '| 平均 | $O(n \\log n)$ | $O(\\log n)$ | 分区大致均衡 |',
    '| 最坏 | $O(n^2)$ | $O(n)$ | 每次都取到极值 |',
    '| 最好 | $O(n \\log n)$ | $O(\\log n)$ | 每次正好二分 |',
    '',
    '平均比较次数约为 $1.39\\, n \\log_2 n$。',
    '',
    '### 实践建议',
    '',
    '- 小数组（长度 < 16）改用**插入排序**更快',
    '- 递归深度超过 `2 * log2(n)` 时切换到**堆排序**，可保证 $O(n \\log n)$ 上界',
    '- Python 里对列表排序请直接用 `list.sort()`（Timsort，稳定排序）',
    '',
    '需要我再补充一个非递归（显式栈）版本吗？'
  ].join('\n');

  var SOURCES = [
    { title: 'Quicksort - Wikipedia', url: 'https://en.wikipedia.org/wiki/Quicksort', snippet: 'Quicksort is an efficient, general-purpose sorting algorithm...' },
    { title: '算法导论 第 7 章 快速排序', url: 'https://mitpress.mit.edu/9780262046305/', snippet: '本章介绍快速排序及其随机化版本的分析...' },
    { title: 'Python Sorting HOW TO', url: 'https://docs.python.org/3/howto/sorting.html', snippet: 'Python lists have a built-in list.sort() method...' }
  ];

  var now = Date.now();

  var convo = {
    id: 'demo-1',
    title: '快速排序原理与 Python 实现',
    createdAt: now - 3600000,
    updatedAt: now - 60000,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: '帮我讲讲快速排序的原理，并给一个 Python 实现。',
        createdAt: now - 3600000
      },
      {
        id: 'm2',
        role: 'assistant',
        content: ANSWER,
        reasoning: REASONING,
        reasoningMs: 7400,
        sources: null,
        createdAt: now - 3590000,
        finishReason: 'stop'
      },
      {
        id: 'm3',
        role: 'user',
        content: '这张图里的流程图对吗？',
        images: [IMG],
        createdAt: now - 3000000
      },
      {
        id: 'm4',
        role: 'assistant',
        content: '图里展示的是**分区（partition）**这一步：',
        reasoning: '用户上传了一张图片，需要判断流程图是否正确。',
        reasoningMs: 3100,
        sources: SOURCES,
        createdAt: now - 2990000,
        feedback: 'like',
        finishReason: 'stop'
      },
      {
        id: 'm5',
        role: 'user',
        content: '如果接口报错会怎样显示？',
        createdAt: now - 300000
      },
      {
        id: 'm6',
        role: 'assistant',
        content: '',
        createdAt: now - 299000,
        error: 'API Key 无效或未填写：Authentication Fails, Your api key is invalid'
      }
    ]
  };

  var older = {
    id: 'demo-2',
    title: '整理一份三天的北京旅游攻略',
    createdAt: now - 86400000 * 2,
    updatedAt: now - 86400000 * 2,
    messages: [{ id: 'o1', role: 'user', content: '整理一份三天的北京旅游攻略', createdAt: now - 86400000 * 2 }]
  };

  localStorage.setItem('ds.convos.v1', JSON.stringify([convo, older]));
  localStorage.setItem('ds.active.v1', JSON.stringify('demo-1'));
})();
