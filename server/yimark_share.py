#!/usr/bin/env python3
"""
易码文章分享服务 —— 纯标准库，无第三方依赖。

职责只有「存」与「取」：
  POST /yimark/api/share     body: {"title","markdown","themeId","densityId","images"}  -> {"id"}
  GET  /yimark/api/read/<id>                                                        -> 分享 JSON

设计要点：
- 数据为单文件 JSON 存 /var/lib/yimark-share/<id>.json（tmp + rename 原子写）；
- id 为 10 位 base62 随机串，不可枚举，拿到链接才能读；
- POST 按 IP 限速（每分钟 6 次），body 上限 6MB（nginx 侧同限）；
- 只监听 127.0.0.1，公网只能经 nginx 反代访问；
- 由 systemd（server/yimark-share.service）托管，崩溃自动拉起。
"""
import json
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN = ("127.0.0.1", 8790)
DATA_DIR = os.environ.get("YIMARK_SHARE_DIR", "/var/lib/yimark-share")
MAX_BODY = 6 * 1024 * 1024          # 与 nginx client_max_body_size 保持一致
MAX_IMAGES = 60                     # 单篇分享附带的本地图片上限
MAX_TITLE = 120

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
SHARE_RE = re.compile(r"^/yimark/api/share$")
READ_RE = re.compile(r"^/yimark/api/read/([A-Za-z0-9]{10})$")
IMAGE_RE = re.compile(r"^(data:image/(png|jpeg|jpg|gif|webp);base64,|https?://)")

RATE_LIMIT = 6                      # 每 IP 每分钟可创建的分享数
RATE_WINDOW = 60.0

_lock = threading.Lock()
_hits = defaultdict(deque)          # ip -> 最近成功 POST 的时间戳


def rate_ok(ip):
    """滑动窗口限速：成功创建才计数，读取接口不限。"""
    now = time.time()
    with _lock:
        q = _hits[ip]
        while q and now - q[0] > RATE_WINDOW:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            return False
        q.append(now)
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "yimark-share/1.0"
    protocol_version = "HTTP/1.1"

    def _reply(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # 成功读写不打日志；4xx/5xx 保留（进 journald 便于排查滥用）
        first = str(args[0]) if args else ""
        if " 40" in first or " 50" in first:
            super().log_message(fmt, *args)

    # ---------- 写 ----------
    def do_POST(self):
        if not SHARE_RE.match(self.path):
            return self._reply(404, {"error": "not found"})
        if not rate_ok(self.client_address[0]):
            return self._reply(429, {"error": "分享太频繁，请稍后再试"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._reply(400, {"error": "bad length"})
        if length <= 0 or length > MAX_BODY:
            return self._reply(413, {"error": "内容过大（上限 6MB）"})

        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._reply(400, {"error": "bad json"})

        title = str(data.get("title") or "")[:MAX_TITLE]
        markdown = data.get("markdown")
        if not isinstance(markdown, str) or not markdown.strip():
            return self._reply(400, {"error": "正文为空"})

        images = data.get("images")
        clean = {}
        if isinstance(images, dict):
            for name, value in list(images.items())[:MAX_IMAGES]:
                if isinstance(name, str) and isinstance(value, str) and IMAGE_RE.match(value):
                    clean[name] = value

        record = {
            "title": title,
            "markdown": markdown,
            "themeId": str(data.get("themeId") or "classic"),
            "densityId": str(data.get("densityId") or "standard"),
            "images": clean,
            "createdAt": int(time.time() * 1000),
        }
        share_id = "".join(secrets.choice(ALPHABET) for _ in range(10))
        os.makedirs(DATA_DIR, exist_ok=True)
        final = os.path.join(DATA_DIR, share_id + ".json")
        tmp = final + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
        os.replace(tmp, final)
        self._reply(200, {"id": share_id})

    # ---------- 读 ----------
    def do_GET(self):
        m = READ_RE.match(self.path)
        if not m:
            return self._reply(404, {"error": "not found"})
        path = os.path.join(DATA_DIR, m.group(1) + ".json")
        try:
            with open(path, encoding="utf-8") as f:
                record = json.load(f)
        except (OSError, json.JSONDecodeError):
            return self._reply(404, {"error": "文章不存在或已被删除"})
        record["id"] = m.group(1)
        self._reply(200, record)


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    server = ThreadingHTTPServer(LISTEN, Handler)
    print(f"yimark-share listening on {LISTEN[0]}:{LISTEN[1]}, data dir {DATA_DIR}", flush=True)
    server.serve_forever()
