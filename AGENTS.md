# 工作约定

## 改动流程（必须遵守）

每次改完代码后：

1. **充分自验证**——不要只看编译通过：
   - `npm run build` 确认无类型/编译错误
   - 启动 dev 服务，在浏览器里实际操作验证改动点（用 Playwright/浏览器工具实测渲染、交互与边界情况）
   - 涉及持久化的改动要验证「刷新后行为正确」
   - 相关旧功能回归：改动波及的相邻功能也要点一遍
2. **合入到本地 git**——自验证通过后提交：
   - `git add` 相关文件（只加本次改动涉及的文件）
   - `git commit`，message 用简体中文一句话概括改动内容与原因
   - 只提交到本地，不 push（除非用户明确要求）
3. **部署**（用户明确要求时执行）：
   - 服务器：`root@123.207.255.4`（SSH 免密，id_ed25519）
   - 产物目录：`/var/www/yimark`；vite `base: './'` 相对路径，子路径直接可用，无需改构建
   - 步骤：`npm run build` → `scp -r dist/* root@123.207.255.4:/var/www/yimark/` → 服务端验证：
     `curl -sk -o /dev/null -w '%{http_code}' https://topxai.cn/yimark/ --resolve topxai.cn:443:127.0.0.1`
   - 访问入口：https://topxai.cn:8443/yimark/（443 被腾讯云拦截：topxai.cn 未 ICP 备案，
     平台层 302 到 dnspod webblock / TLS RST，整个域名含 ainav 站公网 443 均不可达；
     备案通过后 https://topxai.cn/yimark/ 自动可用，nginx 规则已就绪，无需改服务器）
   - nginx 站点配置：`/etc/nginx/sites-available/ainav`（改前备份，改后 `nginx -t` + reload）
   - `index.html` 为 no-cache、assets 哈希命名长缓存，部署后用户刷新即得最新版

## 其他

- 不要删除 `.codebuddy/` 目录
- 构建前必须 `npm install`（否则 `tsc: command not found`）
