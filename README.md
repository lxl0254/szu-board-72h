# 深圳大学校园公文通 72 小时摘要

本机单用户网页应用。登录深圳大学统一身份认证后，可选择公文通中的 97 个发文单位，点击一次即可查询已选单位近 72 小时发布的全部通知。默认选择校团委、教务部、学生部、时光学生社区管理委员会、物理与光电工程学院；网页支持搜索、添加、删除和恢复默认选择，并将选择保存在本机浏览器中。

## 启动

```powershell
pnpm install
pnpm exec playwright install chromium
pnpm start
```

打开 `http://127.0.0.1:3210`。

运行环境允许创建可见窗口时，应用会直接打开 Chromium 官方认证页。若当前终端环境不允许 GUI 窗口，网页会显示深圳大学统一身份认证中的企业微信二维码，可直接扫码登录。

## 免费 DeepSeek 摘要

应用默认连接本机 Ollama 的 DeepSeek R1 1.5B 模型，不需要 API Key。首次使用需安装 Ollama 并下载模型：

```powershell
ollama pull deepseek-r1:1.5b
pnpm start
```

默认接口为 `http://127.0.0.1:11434/v1`，模型可通过 `OLLAMA_MODEL` 修改。通知正文只在本机模型中处理，不会发送到外部 AI 服务。若本地模型暂时不可用，网页会自动回退到口语化规则摘要。

如已有 OpenAI 兼容接口，可设置 `OPENAI_API_KEY`、`OPENAI_MODEL` 和可选的 `OPENAI_BASE_URL` 覆盖默认 DeepSeek 配置。

## 数据目录

运行数据保存在 `.data/`：

- `.data/playwright-profile/`：深大登录会话浏览器资料。
- `.data/cache.json`：只保存摘要缓存，不保存原始通知正文。

该目录已加入 `.gitignore`，服务默认只监听本机 `127.0.0.1`。

## 免责声明

本项目是非官方工具，与深圳大学及其任何院系、部门没有隶属或授权关系，也不代表学校立场。使用者需要自行准备有效的校内账号，并自行确保抓取和使用信息的方式符合学校相关规定。作者不对使用本工具产生的任何后果负责。

## 许可证

[MIT](LICENSE)
