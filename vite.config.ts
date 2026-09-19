import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 公众号文章抓取代理（仅开发环境）。生产环境由 nginx 反代同一个路径
 * /yimark/api/fetch 实现，两侧约定一致：只放行 mp.weixin.qq.com，
 * 其余一律 403，避免开放代理被滥用。
 */
function wechatProxyPlugin(): Plugin {
  return {
    name: 'wechat-article-proxy',
    configureServer(server) {
      server.middlewares.use('/yimark/api/fetch', (req, res) => {
        const reply = (code: number, msg: string) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(msg);
        };
        // 目标地址在 X-Target-Url 请求头（与生产 nginx 反代约定一致）
        const target = String(req.headers['x-target-url'] ?? '');
        try {
          const u = new URL(target);
          if (u.hostname !== 'mp.weixin.qq.com' || u.protocol !== 'https:') return reply(403, 'only https://mp.weixin.qq.com allowed');
          void fetch(u, {
            headers: {
              // 微信对无浏览器 UA 的请求会直接返回环境异常页
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              Referer: 'https://mp.weixin.qq.com/',
              'Accept-Language': 'zh-CN,zh;q=0.9',
            },
          })
            .then(async (up) => {
              res.statusCode = up.status;
              res.setHeader('Content-Type', up.headers.get('content-type') ?? 'text/html; charset=utf-8');
              res.end(Buffer.from(await up.arrayBuffer()));
            })
            .catch(() => reply(502, 'upstream fetch failed'));
        } catch {
          reply(400, 'bad url');
        }
      });
    },
  };
}

/**
 * 首屏必需、且几乎不变的依赖 —— 单独成块，换版本才失效，日常发版能一直命中缓存。
 * 注意：只列核心包。@codemirror/lang-* 与 legacy-modes 是 @codemirror/language-data
 * 按需动态加载的语法（构建产物里那一百多个小 chunk），
 * 一旦被归进固定块就会全部变成首屏同步依赖。
 */
const VENDOR_GROUPS: Record<string, string[]> = {
  react: ['react', 'react-dom', 'scheduler'],
  // 图标集几乎不随业务改动，单独成块常驻缓存
  icons: ['@phosphor-icons/react'],
  codemirror: [
    '@codemirror/state',
    '@codemirror/view',
    '@codemirror/commands',
    '@codemirror/search',
    '@codemirror/autocomplete',
    '@codemirror/language',
    '@codemirror/lang-markdown',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    '@lezer/markdown',
    'style-mod',
    'w3c-keyname',
    'crelt',
  ],
  markdown: [
    'markdown-it',
    'markdown-it-footnote',
    'markdown-it-mark',
    'linkify-it',
    'mdurl',
    'uc.micro',
    'entities',
    'punycode.js',
  ],
};

/** node_modules 路径 → 所属分组（按包名精确匹配，避免误伤 lang-* 这类同前缀包） */
function vendorChunk(id: string): string | undefined {
  const m = id.split('node_modules/').pop();
  if (!m) return undefined;
  const pkg = m.startsWith('@') ? m.split('/').slice(0, 2).join('/') : m.split('/')[0];
  for (const [group, pkgs] of Object.entries(VENDOR_GROUPS)) {
    if (pkgs.includes(pkg)) return group;
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), wechatProxyPlugin()],
  base: './',
  build: {
    // 语法高亮与编辑器语法包都已按需加载，剩下的主包应远低于该阈值
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules') ? vendorChunk(id) : undefined),
      },
    },
  },
});
