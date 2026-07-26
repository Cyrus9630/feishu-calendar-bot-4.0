# 飞书日程机器人 4.0 公开版快速安装器实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让安装者准备好飞书 CLI 后，通过双击入口完成 4.0 公开版的大部分部署，仅保留飞书登录授权、秘密输入、对象选择和飞书后台确认。

**架构：** 跨平台入口先检查飞书 CLI，再启动 Node.js 向导。向导新增独立的飞书 CLI 状态与资源发现模块，通过公开 JSON 输出取得当前应用、用户、群聊和可写日历；现有部署模块继续负责妙搭创建、环境变量写入、源码推送和发布。所有秘密仅通过隐藏输入和子进程标准输入流转。

**技术栈：** Node.js ESM、Node.js test runner、飞书 CLI、Git、妙搭全栈应用、Shell、Windows Batch、Markdown、HTML。

---

## 文件结构

- 创建 `部署助手/lib/discovery.mjs`：解析飞书 CLI 配置、身份、群聊和日历 JSON，并执行只读发现命令。
- 修改 `部署助手/lib/core.mjs`：导出通用 JSON 解析函数，增加编号选择校验。
- 修改 `部署助手/lib/process.mjs`：增加把终端控制权交给飞书 CLI 配置和登录流程的交互执行函数。
- 修改 `部署助手/cli.mjs`：编排飞书 CLI 配置、授权、资源发现、用户选择和自动部署。
- 修改 `部署助手/test/wizard.spec.mjs`：覆盖 JSON 信封、资源过滤、编号选择、命令参数和秘密边界。
- 修改 `双击开始部署-macOS.command`、`双击开始部署-Windows.bat`：把飞书 CLI 检查置于所有其他前置条件之前。
- 修改 `README.md`、`README_EN.md`、`先打开我.html`、`给Codex的一句话.txt`：将快速安装作为默认路径，并准确说明仍需用户确认的飞书步骤。

### 任务 1：锁定飞书 CLI 发现与选择行为

**文件：**
- 创建：`部署助手/lib/discovery.mjs`
- 修改：`部署助手/lib/core.mjs`
- 测试：`部署助手/test/wizard.spec.mjs`

- [ ] **步骤 1：编写失败的 JSON 解析和选择测试**

在 `部署助手/test/wizard.spec.mjs` 中加入测试，覆盖直接对象和 `data` 信封两种返回格式：

```js
test('自动读取当前飞书应用和用户身份', () => {
  assert.deepEqual(
    parseWhoAmI('{"appId":"cli_demo","onBehalfOf":{"openId":"ou_user"}}'),
    { appId: 'cli_demo', userOpenId: 'ou_user' },
  );
});

test('只列出群聊和可写日历', () => {
  assert.deepEqual(parseChats('{"data":{"chats":[{"chat_id":"oc_1","name":"项目群"}]}}'), [
    { id: 'oc_1', name: '项目群', detail: '群聊' },
  ]);
  assert.deepEqual(
    parseWritableCalendars('{"data":{"calendar_list":[{"calendar_id":"cal_1","summary":"工作","role":"writer","is_deleted":false,"is_third_party":false},{"calendar_id":"cal_2","summary":"只读","role":"reader"}]}}'),
    [{ id: 'cal_1', name: '工作', detail: 'writer' }],
  );
});

test('编号选择必须明确且在范围内', () => {
  assert.equal(selectNumberedItem([{ id: 'one' }, { id: 'two' }], '2').id, 'two');
  assert.throws(() => selectNumberedItem([{ id: 'one' }], '0'), /请输入 1 到 1/);
});
```

- [ ] **步骤 2：运行测试并确认新增用例失败**

运行：

```bash
node --test 部署助手/test/wizard.spec.mjs
```

预期：因 `parseWhoAmI`、`parseChats`、`parseWritableCalendars` 和 `selectNumberedItem` 尚未定义而失败。

- [ ] **步骤 3：实现最少解析和选择代码**

`部署助手/lib/discovery.mjs` 应当输出稳定的内部结构：

```js
export function parseWhoAmI(output) {
  const value = parseJsonOutput(output, '飞书身份');
  const data = value?.data ?? value;
  const appId = String(data?.appId ?? data?.app_id ?? '');
  const userOpenId = String(data?.onBehalfOf?.openId ?? data?.user?.open_id ?? '');
  if (!appId.startsWith('cli_') || !userOpenId.startsWith('ou_')) {
    throw new Error('飞书 CLI 已登录，但没有读到当前应用或用户身份。');
  }
  return { appId, userOpenId };
}
```

`parseChats` 只接受 `oc_` 标识；`parseWritableCalendars` 排除删除、第三方以及非 `owner`/`writer` 日历。`selectNumberedItem` 把输入解析为一位起始编号，不得默认第一个项目。

- [ ] **步骤 4：运行测试并确认通过**

运行：

```bash
node --test 部署助手/test/wizard.spec.mjs
```

预期：新增和既有用例全部通过。

- [ ] **步骤 5：提交解析与选择能力**

```bash
git add 部署助手/lib/discovery.mjs 部署助手/lib/core.mjs 部署助手/test/wizard.spec.mjs
git commit -m "feat: discover Feishu deployment targets"
```

### 任务 2：实现飞书 CLI 配置、授权和自动发现流程

**文件：**
- 修改：`部署助手/lib/process.mjs`
- 修改：`部署助手/lib/discovery.mjs`
- 修改：`部署助手/cli.mjs`
- 测试：`部署助手/test/wizard.spec.mjs`

- [ ] **步骤 1：编写失败的命令编排测试**

使用假的 `runner` 记录调用，验证发现模块只调用公开命令：

```js
test('发现流程使用当前身份、群聊和可写日历命令', async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'whoami') {
      return { code: 0, stdout: '{"appId":"cli_demo","onBehalfOf":{"openId":"ou_user"}}', stderr: '' };
    }
    if (args[0] === 'im') {
      return { code: 0, stdout: '{"data":{"chats":[]}}', stderr: '' };
    }
    return { code: 0, stdout: '{"data":{"calendar_list":[]}}', stderr: '' };
  };
  await discoverTargets({ runner });
  assert.deepEqual(calls.map((call) => call[1].slice(0, 2)), [
    ['whoami'],
    ['im', '+chat-list'],
    ['calendar', 'calendars'],
  ]);
});
```

另写测试验证配置缺失时调用 `config init --new`，登录无效时调用限定 `apps`、`im`、`calendar` 的 `auth login`，完成后必须重新执行 `auth status --json --verify`。

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
node --test 部署助手/test/wizard.spec.mjs
```

预期：因 `discoverTargets`、`ensureLarkReady` 和交互执行器尚未实现而失败。

- [ ] **步骤 3：增加交互子进程执行器**

在 `部署助手/lib/process.mjs` 中使用 `spawn` 和 `stdio: 'inherit'` 实现：

```js
export function runInteractive(command, args = [], { cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: 'inherit', windowsHide: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ code: 0 });
      else reject(new Error(`${command} 未完成，请按上方提示重试。`));
    });
  });
}
```

- [ ] **步骤 4：实现配置和登录恢复**

`ensureLarkReady` 先运行 `config show`；失败时通过交互执行器运行 `config init --new`。随后运行 `auth status --json --verify`；失败时运行：

```text
lark-cli auth login --domain apps --domain im --domain calendar
```

交互流程结束后重新验证；不得把“命令已启动”视为“登录已完成”。

- [ ] **步骤 5：改造主向导**

把原来的 App ID、群 ID、用户 ID和日历 ID手工提问替换为：

1. 自动准备飞书 CLI；
2. 自动读取当前 App ID和用户 open_id；
3. 显示群聊编号并要求选择；
4. 显示可写日历编号并要求选择；
5. 隐藏输入 App Secret、Verification Token 和可选 Encrypt Key；
6. 验证机器人 open_id；
7. 显示名称摘要并要求一次“开始部署”。

发现结果为空时，说明所需 `im` 或 `calendar` 权限和恢复命令，不得要求用户直接填写技术 ID绕过发现。

- [ ] **步骤 6：运行向导测试和自检**

运行：

```bash
node --test 部署助手/test/wizard.spec.mjs
node 部署助手/cli.mjs --check --json
```

预期：测试全部通过；自检 JSON 明确显示 `node`、`git` 和 `larkCli` 状态。

- [ ] **步骤 7：提交快速向导**

```bash
git add 部署助手/lib/process.mjs 部署助手/lib/discovery.mjs 部署助手/cli.mjs 部署助手/test/wizard.spec.mjs
git commit -m "feat: automate public bot setup"
```

### 任务 3：把飞书 CLI 设为双击入口的首要前置条件

**文件：**
- 修改：`双击开始部署-macOS.command`
- 修改：`双击开始部署-Windows.bat`
- 测试：`部署助手/test/wizard.spec.mjs`

- [ ] **步骤 1：编写失败的入口顺序测试**

读取两个入口文件，验证 `lark-cli` 检查出现在 Node.js 和 Git 提示之前，并包含官方安装命令：

```js
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('双击入口首先提示安装飞书 CLI', async () => {
  const mac = await readFile(join(packageRoot, '双击开始部署-macOS.command'), 'utf8');
  const windows = await readFile(join(packageRoot, '双击开始部署-Windows.bat'), 'utf8');
  for (const source of [mac, windows]) {
    assert.ok(source.indexOf('lark-cli') < source.indexOf('Node.js'));
    assert.match(source, /npx @larksuite\/cli@latest install/);
  }
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
node --test 部署助手/test/wizard.spec.mjs
```

预期：现有入口先检查 Node.js，测试失败。

- [ ] **步骤 3：修改 Windows 和 macOS 入口**

两个入口均先执行 `lark-cli --version`。失败时输出统一中文说明、安装命令和 `https://github.com/larksuite/cli`，等待用户确认后退出。成功后检查 Node.js 与 Git；缺少 Git 时给出当前系统的明确修复入口。

- [ ] **步骤 4：运行入口和向导测试**

运行：

```bash
node --test 部署助手/test/wizard.spec.mjs
sh -n 双击开始部署-macOS.command
```

预期：全部通过。

- [ ] **步骤 5：提交入口修改**

```bash
git add 双击开始部署-macOS.command 双击开始部署-Windows.bat 部署助手/test/wizard.spec.mjs
git commit -m "feat: make lark-cli the installer prerequisite"
```

### 任务 4：更新公开安装说明

**文件：**
- 修改：`README.md`
- 修改：`README_EN.md`
- 修改：`先打开我.html`
- 修改：`给Codex的一句话.txt`

- [ ] **步骤 1：更新默认安装路径**

README 中文首页应当在功能介绍后直接说明：

1. 安装飞书 CLI；
2. 下载并解压 4.0 发行包；
3. 双击系统入口；
4. 在浏览器完成登录授权；
5. 选择群聊和可写日历；
6. 隐藏输入飞书秘密并确认部署；
7. 按自动打开的飞书页面完成权限、事件、发布和入群。

详细命令保留为故障排查，不再作为默认安装方式。

- [ ] **步骤 2：更新英文边界说明**

英文 README 同步解释快速安装条件、仍需人工完成的飞书确认，以及当前仅支持中文自然语言指令。不得把英文说明表述为英文指令解析能力。

- [ ] **步骤 3：更新欢迎页和 Codex 指令**

欢迎页把“双击快速安装”放在首位，只列飞书 CLI 一个显式软件前置条件。Codex 指令改为复用自动发现流程，不再要求用户手工提供群 ID、用户 open_id、日历 ID和妙搭 ID。

- [ ] **步骤 4：执行文档和禁用功能检查**

运行：

```bash
rg -n "TARGET_OPEN_ID|目标群 chat_id|目标日历 ID" README.md README_EN.md 先打开我.html 给Codex的一句话.txt
node scripts/share-tools/verify-package.mjs .
```

预期：第一项只在详细故障排查或环境变量说明中出现，不再作为默认手工输入；第二项返回 `ok: true` 且 `findings` 为空。

- [ ] **步骤 5：提交公开说明**

```bash
git add README.md README_EN.md 先打开我.html 给Codex的一句话.txt
git commit -m "docs: explain quick public installation"
```

### 任务 5：全量验证并发布 4.0.4

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 使用：`scripts/share-tools/verify-package.mjs`

- [ ] **步骤 1：更新补丁版本**

将公开包版本从 `4.0.0` 更新为 `4.0.4`，并同步锁文件。发布前查询现有标签，确认 `v4.0.4` 尚未使用；不覆盖或删除历史标签。

- [ ] **步骤 2：运行完整验证**

运行：

```bash
npm run type:check
npm test -- --runInBand
SKIP_ACTION_PLUGIN_INIT=true npm run build:prod
node 部署助手/cli.mjs --check --json
node scripts/share-tools/verify-package.mjs .
```

发布包自检应当在排除 `.git`、`node_modules` 和构建产物的独立副本或 Git 归档中执行。公开功能扫描必须保持已排除旧功能及其依赖零残留。

- [ ] **步骤 3：提交版本并推送分支**

```bash
git add package.json package-lock.json
git commit -m "release: prepare Feishu Calendar Bot 4.0.4"
git push -u origin feat/quick-installer
```

- [ ] **步骤 4：合并并推送公开主分支**

在确认分支测试和构建通过后，将 `feat/quick-installer` 快进或普通合并到 `main`，不得强制推送。

- [ ] **步骤 5：创建新的发行版**

创建新的带注释标签 `v4.0.4`，推送标签并创建中英双语 GitHub Release。发行说明应当准确列明快速安装流程和仍需用户完成的飞书确认。

- [ ] **步骤 6：从 GitHub 匿名下载验收**

下载新标签的 GitHub 自动生成源码压缩包，在全新临时目录解压后运行：

```bash
node 部署助手/cli.mjs --check --json
node scripts/share-tools/verify-package.mjs .
```

随后执行禁用功能扫描、README 快速安装文案检查、匿名 HTTP 访问和本地/远程 SHA 对比。只有以上检查全部通过，才能向用户报告新的推荐发行版。
