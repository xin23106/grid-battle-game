# -*- coding: utf-8 -*-
"""
serve.py —— 英雄战棋的本地网页服务（禁用浏览器缓存）
会在本脚本所在目录起一个静态服务，默认端口 8765。
之所以不用 `python -m http.server`：那个会触发浏览器缓存，
导致改了 game.js / net.js / index.html 之后页面还是旧的。
"""
import http.server
import socketserver
import os
import sys
import webbrowser

PORT = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # 安静模式


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        with Server(("", PORT), Handler) as httpd:
            print("HeroChess web server (no-cache) -> http://localhost:%d/index.html" % PORT)
            print("Keep this window open. Press Ctrl+C or close it to stop.")
            httpd.serve_forever()
    except OSError as e:
        print("无法启动网页服务（端口 %d 可能被占用）：%s" % (PORT, e))
        print("请先关闭占用 8765 的程序，或修改本文件里的 PORT。")
        sys.exit(1)


if __name__ == "__main__":
    main()
