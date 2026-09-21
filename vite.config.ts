import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** dev 分享 stub 的存储条目（与生产 server/yimark_share.py 的 JSON 结构一致） */
interface ShareItem {
  title: string;
  markdown: string;
  themeId: string;
  densityId: string;
  images: Record<string, string>;
  createdAt: number;
}

const json = (res: ServerResponse, code: number, data: unknown) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const randomId = () =>
  Array.from({ length: 10 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

/**
 * 文章分享 stub（仅开发环境）。生产环境由 nginx 把 /yimark/api/share、
 * /yimark/api/read/<id> 反代到本机 share 服务（server/yimark_share.py）。
 * dev 用内存 Map：重启即失，只用于联调分享弹窗与阅读页。
 */
function shareStubPlugin(): Plugin {
  return {
    name: 'share-stub',
    configureServer(server) {
      const store = new Map<string, ShareItem>();
      server.middlewares.use('/yimark/api/share', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        const chunks: Buffer[] = [];
        let size = 0;
        let overflow = false;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > 6 * 1024 * 1024) {
            overflow = true;
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => {
          if (overflow) return json(res, 413, { error: 'too large' });
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Partial<ShareItem>;
            if (typeof data.markdown !== 'string' || !data.markdown.trim()) {
              return json(res, 400, { error: 'empty markdown' });
            }
            const id = randomId();
            store.set(id, {
              title: String(data.title ?? '').slice(0, 120),
              markdown: data.markdown,
              themeId: String(data.themeId ?? 'classic'),
              densityId: String(data.densityId ?? 'standard'),
              images: data.images && typeof data.images === 'object' ? data.images : {},
              createdAt: Date.now(),
            });
            json(res, 200, { id });
          } catch {
            json(res, 400, { error: 'bad json' });
          }
        });
      });
      server.middlewares.use('/yimark/api/read/', (req: IncomingMessage, res: ServerResponse) => {
        const id = (req.url ?? '').replace(/^\/([A-Za-z0-9]+).*$/, '$1');
        const hit = store.get(id);
        if (!hit) return json(res, 404, { error: 'not found' });
        json(res, 200, { id, ...hit });
      });
    },
  };
}

/**
 * 文章抓取代理允许的域名白名单。
 *
 * **必须与 src/webImport.ts 的 SITES 保持一致**（前端负责校验与提示，
 * 服务端负责真正拦截；前端校验可被绕过，所以这里才是安全边界）。
 * 生产环境同一份清单在 nginx 的 snippet 里，改这里要同步改那儿。
 */
const ALLOWED_HOSTS = [
  'mp.weixin.qq.com',
  'juejin.cn',
  'sspai.com',
  'zhihu.com',
  'www.zhihu.com',
  'zhuanlan.zhihu.com',
  'xiaohongshu.com',
  'www.xiaohongshu.com',
  'www.jianshu.com',
  'medium.com',
  'www.36kr.com',
  'www.infoq.cn',
  'www.cnblogs.com',
  'blog.csdn.net',
];

/** 域名是否在白名单（允许 www 前缀的有无互相命中） */
function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_HOSTS.some((a) => a === h || a === `www.${h}` || `www.${a}` === h);
}

/**
 * 文章抓取代理（仅开发环境）。生产环境由 nginx 反代同一个路径
 * /yimark/api/fetch 实现，两侧约定一致：只放行白名单域名，其余一律 403，
 * 避免开放代理被滥用。
 */
function articleProxyPlugin(): Plugin {
  return {
    name: 'article-import-proxy',
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
          if (u.protocol !== 'https:') return reply(403, 'only https allowed');
          if (!hostAllowed(u.hostname)) return reply(403, `only allow-listed hosts allowed: ${u.hostname}`);
          void fetch(u, {
            headers: {
              // 各站点对无浏览器 UA 的请求多会拦截或降级
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9',
            },
            redirect: 'follow',
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
  plugins: [react(), articleProxyPlugin(), shareStubPlugin()],
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
